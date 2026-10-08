import { Injectable } from '@nestjs/common';
import type { ZodError } from 'zod';

import { AppException } from '@/core/errors';

import { importColumnSets, isModifiable, matchColumns } from '../data-transfer.columns';
import type { AnyColumn } from '../data-transfer.columns';
import { MULTI_VALUE_SEPARATOR, REFERENCE_SEARCH_LIMIT } from '../data-transfer.constants';
import type {
  AnyTransferResource,
  ImportMode,
  MatchResult,
  ResolvedReference,
  ResolvedRow,
  RowIssue,
  TransferContext,
} from '../data-transfer.types';
import { cleanText, closest, normalizeText, parseCell, toCellText } from '../data-transfer.values';
import type { RowValidation } from '../dto/data-transfer.dto';
import {
  collectFileKeys,
  isSameFileRef,
  planSameFile,
  sameFileColumns,
  sameFileKeyOf,
  sameFileRef,
} from './same-file';
import type { SameFileRef } from './same-file';

export interface ImportRowInput {
  rowNo: number;
  cells: Readonly<Record<string, string>>;
  /** 修改模式手動指定的目標：`undefined` 依比對鍵自動比對、`null` 撤回比對、字串是紀錄 id（§7.5）。 */
  targetId?: string | null;
}

/** 驗證後的一列：給回應（issues、target、changed）也給套用（values、patch）。 */
export interface ValidatedRow {
  rowNo: number;
  issues: RowIssue[];
  /** 轉換後的值：有填（或 `\N` 清空成 null）的欄位；`reference` 是 id（多值是 id 陣列）。 */
  values: Record<string, unknown>;
  /** 新值的文字表示（`reference` 是解析後的名稱），結果報告記錄「原值 → 新值」用。 */
  texts: Record<string, string>;
  target?: MatchResult<unknown>;
  /** 修改模式：檔案中有的欄位的目前值（文字表示）。 */
  current?: Record<string, string>;
  changed?: string[];
}

export function hasErrors(row: Pick<ValidatedRow, 'issues'>): boolean {
  return row.issues.some((issue) => issue.severity === 'error');
}

function error(column: string | null, code: string, params?: Record<string, unknown>): RowIssue {
  return { column, code, ...(params ? { params } : {}), severity: 'error' };
}

/** Zod 的 issue → 問題代碼（§7.4：`tooShort { min }`、`tooLong { max }`、`invalidFormat { format }`…）。 */
export function zodIssue(column: string, zodError: ZodError): RowIssue {
  const issue = zodError.issues[0];
  if (!issue) return error(column, 'invalidFormat');
  const origin = (issue as { origin?: string }).origin;
  if (issue.code === 'too_small') {
    const min = Number((issue as { minimum?: number | bigint }).minimum ?? 0);
    return error(column, origin === 'string' ? 'tooShort' : 'tooSmall', { min });
  }
  if (issue.code === 'too_big') {
    const max = Number((issue as { maximum?: number | bigint }).maximum ?? 0);
    return error(column, origin === 'string' ? 'tooLong' : 'tooLarge', { max });
  }
  if (issue.code === 'invalid_format') {
    return error(column, 'invalidFormat', {
      format: (issue as { format?: string }).format ?? 'text',
    });
  }
  return error(column, 'invalidFormat');
}

/** 多值比較時不計順序。 */
function comparable(text: string, multiple: boolean): string {
  if (!multiple) return text;
  return text
    .split(MULTI_VALUE_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean)
    .toSorted()
    .join(MULTI_VALUE_SEPARATOR);
}

/**
 * 匯入的驗證器（docs/architecture/backend/22-data-transfer.md §7.4）：`analyze`、`validate` 與套用工作用同一個，規則只有一份。
 * 型別轉換與欄位的 schema、`enum`／`reference` 對應、資料庫重複（新增模式）、比對目標（修改模式）、資源特有的規則都在這裡；
 * 檔案內重複與同一個目標多次只在 `crossRow` 時計算（套用工作，D23；預覽時由前端計算）。
 */
@Injectable()
export class ImportValidator {
  async validate(
    resource: AnyTransferResource,
    mode: ImportMode,
    inputs: readonly ImportRowInput[],
    ctx: TransferContext,
    options: {
      crossRow?: boolean;
      /** 預覽的 `validate`：這批列引用到、而且檔案裡有的值（§7.8）；分析與套用工作手上就是整份檔案，不必帶。 */
      fileKeys?: Readonly<Record<string, readonly string[]>>;
    } = {},
  ): Promise<ValidatedRow[]> {
    const sets = importColumnSets(resource, mode, ctx);
    const byKey = new Map(sets.importable.map((column) => [column.key, column]));
    // 這次的欄位必須都是可以匯入、有權限的欄位（`analyze` 產生的 JSON 一定符合；竄改過的請求擋下）
    for (const input of inputs) {
      const unknown = Object.keys(input.cells).find((key) => !byKey.has(key));
      if (unknown) throw new AppException('DATA_TRANSFER_MAPPING_INVALID', { column: unknown });
    }

    const rows: ValidatedRow[] = inputs.map((input) => ({
      rowNo: input.rowNo,
      issues: [],
      values: {},
      texts: {},
    }));
    const references = new Map<AnyColumn, Set<string>>();

    // 1. 型別轉換與 schema
    inputs.forEach((input, index) => {
      const row = rows[index];
      if (!row) return;
      for (const [key, raw] of Object.entries(input.cells)) {
        const column = byKey.get(key);
        if (!column?.import) continue;
        const parsed = parseCell(column, raw, ctx);
        if (parsed.kind === 'empty') continue;
        if (parsed.kind === 'null') {
          if (mode === 'create') continue;
          if (!column.import.nullable) row.issues.push(error(key, 'notNullable'));
          else {
            row.values[key] = null;
            row.texts[key] = '';
          }
          continue;
        }
        if (parsed.kind === 'issue') {
          row.issues.push(error(key, parsed.code, parsed.params));
          continue;
        }
        const items = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
        const checked: unknown[] = [];
        let failed = false;
        for (const item of items) {
          const result = column.import.schema.safeParse(item);
          if (!result.success) {
            row.issues.push(zodIssue(key, result.error));
            failed = true;
            break;
          }
          checked.push(result.data);
        }
        if (failed) continue;
        const value = Array.isArray(parsed.value) ? checked : checked[0];
        row.values[key] = value;
        row.texts[key] = toCellText(column, value, ctx);
        if (column.kind === 'reference') {
          const names = references.get(column) ?? new Set<string>();
          for (const name of checked) names.add(String(name));
          references.set(column, names);
        }
      }
    });

    // 2. 參照：完全相符才算對上，不自動更正；附上最接近的候選（D7）。新增模式還可以指向檔案裡的其他列（§7.8）
    const inFile =
      mode === 'create' ? collectFileKeys(resource, inputs, options.fileKeys) : new Map();
    await this.resolveReferences(rows, references, ctx, inFile);
    if (mode === 'create') this.checkSameFileCycles(resource, inputs, rows);

    // 3. 必填（新增模式）
    if (mode === 'create') {
      const required = sets.importable.filter((column) => column.import?.requiredOnCreate);
      for (const row of rows) {
        for (const column of required) {
          if (
            row.values[column.key] === undefined &&
            !row.issues.some((issue) => issue.column === column.key)
          ) {
            row.issues.push(error(column.key, 'required'));
          }
        }
      }
      await this.checkExisting(resource, rows, ctx);
    } else {
      await this.matchTargets(resource, sets.importable, inputs, rows, ctx);
    }

    // 4. 資源特有的規則
    if (resource.importer?.validateRows) {
      const resolved: ResolvedRow[] = rows
        .filter((row) => !hasErrors(row))
        .map((row) => ({
          rowNo: row.rowNo,
          values: row.values,
          target: row.target,
          changed: row.changed,
        }));
      if (resolved.length) {
        const extra = await resource.importer.validateRows(mode, resolved, ctx);
        for (const row of rows) row.issues.push(...(extra.get(row.rowNo) ?? []));
      }
    }

    // 5. 修改模式：沒有變更的列（警告，套用時略過）
    if (mode === 'update') {
      for (const row of rows) {
        if (row.target && !hasErrors(row) && !row.changed?.length) {
          row.issues.push({ column: null, code: 'noChanges', severity: 'warning' });
        }
      }
    }

    if (options.crossRow) this.crossRowChecks(resource, mode, inputs, rows);
    return rows;
  }

  toResponse(row: ValidatedRow): RowValidation {
    return {
      rowNo: row.rowNo,
      issues: row.issues,
      ...(row.target && row.current
        ? {
            target: {
              id: row.target.id,
              label: row.target.label,
              version: row.target.version,
              current: row.current,
              ...(row.target.expected ? { expected: { ...row.target.expected } } : {}),
            },
            changed: row.changed ?? [],
          }
        : {}),
    };
  }

  private async resolveReferences(
    rows: ValidatedRow[],
    references: Map<AnyColumn, Set<string>>,
    ctx: TransferContext,
    inFile: ReadonlyMap<string, ReadonlySet<string>>,
  ): Promise<void> {
    for (const [column, names] of references) {
      const spec = column.reference;
      if (!spec) continue;
      const resolved = await spec.resolve([...names], ctx);
      const sameFile = spec.sameFile ? inFile.get(spec.sameFile.column) : undefined;
      const suggestions = new Map<string, string | null>();
      const suggest = async (name: string): Promise<string | null> => {
        if (suggestions.has(name)) return suggestions.get(name) ?? null;
        const candidates =
          suggestions.size < REFERENCE_SEARCH_LIMIT ? await spec.search(name.slice(0, 2), ctx) : [];
        const best = closest(
          name,
          candidates.map((candidate) => candidate.label),
        );
        suggestions.set(name, best);
        return best;
      };
      for (const row of rows) {
        const value = row.values[column.key];
        if (value === undefined || value === null) continue;
        const items = (Array.isArray(value) ? value : [value]).map(String);
        const ids: Array<string | SameFileRef> = [];
        const labels: string[] = [];
        let failed = false;
        for (const name of items) {
          const match: ResolvedReference | undefined = resolved.get(normalizeText(name));
          if (!match && sameFile?.has(normalizeText(name))) {
            // 資料庫裡沒有、檔案裡有：套用時換成那一列建立的 id
            ids.push(sameFileRef(normalizeText(name)));
            labels.push(name);
            continue;
          }
          if (!match) {
            const suggestion = await suggest(name);
            row.issues.push(
              error(column.key, 'referenceNotFound', {
                value: name,
                ...(suggestion ? { suggestion } : {}),
              }),
            );
            failed = true;
          } else if (match === 'ambiguous') {
            row.issues.push(error(column.key, 'ambiguousReference', { value: name }));
            failed = true;
          } else {
            ids.push(match.id);
            labels.push(match.label);
          }
        }
        if (failed) {
          delete row.values[column.key];
          continue;
        }
        row.values[column.key] = column.multiple ? [...new Set(ids)] : ids[0];
        row.texts[column.key] = labels.join(MULTI_VALUE_SEPARATOR);
      }
    }
  }

  /** 同檔引用形成循環（含引用自己）的列：永遠沒有一列能先建立（§7.8）。 */
  private checkSameFileCycles(
    resource: AnyTransferResource,
    inputs: readonly ImportRowInput[],
    rows: ValidatedRow[],
  ): void {
    const columns = sameFileColumns(resource);
    if (!columns.length) return;
    const cells = new Map(inputs.map((input) => [input.rowNo, input.cells]));
    const { cyclic } = planSameFile(
      rows,
      (row) =>
        columns.flatMap((column) => {
          const value = row.values[column.key];
          return isSameFileRef(value) ? [value.key] : [];
        }),
      (row) =>
        columns.flatMap((column) => {
          const key = sameFileKeyOf(
            cells.get(row.rowNo) ?? {},
            column.reference?.sameFile?.column ?? '',
          );
          return key ? [key] : [];
        }),
    );
    for (const row of cyclic) {
      const column = columns.find((item) => isSameFileRef(row.values[item.key]));
      if (!column) continue;
      row.issues.push(error(column.key, 'referenceCycle', { value: row.texts[column.key] ?? '' }));
      delete row.values[column.key];
    }
  }

  /** 新增模式：唯一欄以一次查詢比對資料庫，命中的列標 `alreadyExists`。 */
  private async checkExisting(
    resource: AnyTransferResource,
    rows: ValidatedRow[],
    ctx: TransferContext,
  ): Promise<void> {
    const importer = resource.importer;
    if (!importer?.findExisting) return;
    for (const key of importer.uniqueColumns ?? []) {
      const values = [
        ...new Set(
          rows.flatMap((row) =>
            typeof row.values[key] === 'string' ? [normalizeText(row.values[key])] : [],
          ),
        ),
      ];
      if (!values.length) continue;
      const existing = await importer.findExisting(key, values, ctx);
      for (const row of rows) {
        const value = row.values[key];
        if (typeof value === 'string' && existing.has(normalizeText(value))) {
          row.issues.push(error(key, 'alreadyExists', { value }));
        }
      }
    }
  }

  /**
   * 修改模式（§7.5）：比對鍵依 `matchKey` 的順序；有 `id` 而且有填就只用 `id`，找不到是錯誤、不改用 email 重試。
   * 使用者在預覽中手動指定目標（`targetId`）時以 id 找它，比對鍵不再用來找目標；撤回比對（`null`）是錯誤。
   * 以操作者的權限查，看不到的紀錄等同不存在。比對成功時算出目前值與有變更的欄位。
   */
  private async matchTargets(
    resource: AnyTransferResource,
    importable: readonly AnyColumn[],
    inputs: readonly ImportRowInput[],
    rows: ValidatedRow[],
    ctx: TransferContext,
  ): Promise<void> {
    const importer = resource.importer;
    if (!importer?.resolveTargets) return;
    const keys = matchColumns(importable);
    const wanted = new Map<string, Set<string>>();
    const chosen = new Map<number, { column: AnyColumn; value: string }>();
    const manualIds = new Set<string>();
    inputs.forEach((input, index) => {
      const row = rows[index];
      if (!row) return;
      if (input.targetId === null) {
        row.issues.push(error(null, 'targetNotSelected'));
        return;
      }
      if (input.targetId !== undefined) {
        manualIds.add(input.targetId);
        return;
      }
      const column = keys.find((key) => cleanText(input.cells[key.key] ?? '') !== '');
      if (!column) {
        row.issues.push(error(null, 'matchKeyRequired'));
        return;
      }
      if (row.issues.some((issue) => issue.column === column.key)) return;
      const value = normalizeText(cleanText(input.cells[column.key] ?? ''));
      chosen.set(index, { column, value });
      const values = wanted.get(column.key) ?? new Set<string>();
      values.add(value);
      wanted.set(column.key, values);
    });
    const found = new Map<string, ReadonlyMap<string, readonly MatchResult<unknown>[]>>();
    for (const [column, values] of wanted) {
      found.set(column, await importer.resolveTargets(column, [...values], ctx));
    }
    const manual: ReadonlyMap<string, MatchResult<unknown>> = manualIds.size &&
    importer.findTargetsById
      ? await importer.findTargetsById([...manualIds], ctx)
      : new Map();
    inputs.forEach((input, index) => {
      const row = rows[index];
      if (!row) return;
      if (typeof input.targetId === 'string') {
        const target = manual.get(input.targetId);
        if (target) this.compareWithTarget(importable, input, row, target, ctx);
        else row.issues.push(error(null, 'targetNotFound', { value: input.targetId }));
        return;
      }
      const pick = chosen.get(index);
      if (!pick) return;
      const matches = found.get(pick.column.key)?.get(pick.value) ?? [];
      if (matches.length === 0) {
        row.issues.push(error(pick.column.key, 'targetNotFound', { value: pick.value }));
        return;
      }
      if (matches.length > 1) {
        row.issues.push(
          error(pick.column.key, 'ambiguousMatch', { value: pick.value, count: matches.length }),
        );
        return;
      }
      const target = matches[0];
      if (target) this.compareWithTarget(importable, input, row, target, ctx);
    });
  }

  /** 比對到目標之後：檔案中有的欄位的目前值，以及有變更（而且轉移合法）的欄位。 */
  private compareWithTarget(
    importable: readonly AnyColumn[],
    input: ImportRowInput,
    row: ValidatedRow,
    target: MatchResult<unknown>,
    ctx: TransferContext,
  ): void {
    row.target = target;
    row.current = {};
    row.changed = [];
    for (const key of Object.keys(input.cells)) {
      const column = importable.find((item) => item.key === key);
      if (!column?.export) continue;
      const currentValue = column.export.get(target.record);
      const currentText = toCellText(column, currentValue, ctx);
      row.current[key] = currentText;
      if (!isModifiable(column, 'update') || !(key in row.values)) continue;
      const nextText = row.texts[key] ?? '';
      if (
        comparable(nextText, Boolean(column.multiple)) ===
        comparable(currentText, Boolean(column.multiple))
      ) {
        // 與目前值相同：不送出
        delete row.values[key];
        delete row.texts[key];
        continue;
      }
      const transitions = column.import?.transitions;
      if (transitions) {
        const from = String(currentValue ?? '');
        const to = String(row.values[key] ?? '');
        if (!(transitions[from] ?? []).includes(to)) {
          row.issues.push(
            error(key, 'transitionNotAllowed', { from: currentText, to: row.texts[key] ?? to }),
          );
          continue;
        }
      }
      row.changed.push(key);
    }
  }

  /** 檔案內重複與同一個目標出現多次（套用工作在伺服器端重算，D23）。 */
  private crossRowChecks(
    resource: AnyTransferResource,
    mode: ImportMode,
    inputs: readonly ImportRowInput[],
    rows: ValidatedRow[],
  ): void {
    const byRowNo = new Map(inputs.map((input) => [input.rowNo, input]));
    for (const key of resource.importer?.uniqueColumns ?? []) {
      const seen = new Map<string, number[]>();
      inputs.forEach((input) => {
        const value = normalizeText(cleanText(input.cells[key] ?? ''));
        if (!value) return;
        const list = seen.get(value) ?? [];
        list.push(input.rowNo);
        seen.set(value, list);
      });
      for (const row of rows) {
        const input = byRowNo.get(row.rowNo);
        const value = normalizeText(cleanText(input?.cells[key] ?? ''));
        const others = value ? (seen.get(value) ?? []) : [];
        if (others.length > 1) row.issues.push(error(key, 'duplicateInFile', { rows: others }));
      }
    }
    if (mode === 'update') {
      const targets = new Map<string, number[]>();
      for (const row of rows) {
        if (!row.target) continue;
        const list = targets.get(row.target.id) ?? [];
        list.push(row.rowNo);
        targets.set(row.target.id, list);
      }
      for (const row of rows) {
        const same = row.target ? (targets.get(row.target.id) ?? []) : [];
        if (same.length > 1) row.issues.push(error(null, 'duplicateTarget', { rows: same }));
      }
    }
  }
}
