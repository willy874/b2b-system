import { fetchGroupRestoreMutation } from './fetcher';

/** 還原刪除的群組：成員與持有的角色一併恢復（反提權與加成員相同，ADR-0024 D11）。 */
export const getGroupRestoreMutationOptions = () => ({ mutationFn: fetchGroupRestoreMutation });
