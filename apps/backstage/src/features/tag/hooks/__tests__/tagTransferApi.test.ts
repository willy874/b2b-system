import { describeDataTransferApi, describeImportApi } from '@/test/dataTransferApiContract';

import { tagExportApi, tagImportApi } from '../tagTransferApi';

describeDataTransferApi('tagExportApi', tagExportApi);
describeImportApi('tagImportApi', tagImportApi);
