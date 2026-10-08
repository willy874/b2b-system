import { describeDataTransferApi, describeImportApi } from '@/test/dataTransferApiContract';

import { orgUnitExportApi, orgUnitImportApi } from '../orgUnitTransferApi';

describeDataTransferApi('orgUnitExportApi', orgUnitExportApi);
describeImportApi('orgUnitImportApi', orgUnitImportApi);
