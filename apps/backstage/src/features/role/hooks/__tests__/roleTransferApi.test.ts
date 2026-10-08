import { describeDataTransferApi, describeImportApi } from '@/test/dataTransferApiContract';

import { roleExportApi, roleImportApi } from '../roleTransferApi';

describeDataTransferApi('roleExportApi', roleExportApi);
describeImportApi('roleImportApi', roleImportApi);
