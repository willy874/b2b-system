import { describeDataTransferApi, describeImportApi } from '@/test/dataTransferApiContract';

import { userExportApi, userImportApi } from '../userTransferApi';

describeDataTransferApi('userExportApi', userExportApi);
describeImportApi('userImportApi', userImportApi);
