import { describeDataTransferApi, describeImportApi } from '@/test/dataTransferApiContract';

import { groupExportApi, groupImportApi } from '../groupTransferApi';

describeDataTransferApi('groupExportApi', groupExportApi);
describeImportApi('groupImportApi', groupImportApi);
