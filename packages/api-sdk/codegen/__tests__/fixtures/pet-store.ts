/** 刻意涵蓋產生器各分支的 OpenAPI 3.1 spec：循環引用、各種參數位置、multipart、非 JSON 回應、錯誤回應。 */
export const petStoreSpec = {
  openapi: '3.1.0',
  info: { title: 'Pet Store', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        tags: ['pets'],
        summary: '寵物列表',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, default: 20 } },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'array', items: { $ref: '#/components/schemas/PetStatus' } },
          },
          { name: 'X-Request-Id', in: 'header', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createPet',
        tags: ['pets'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/NewPet' } } },
        },
        responses: {
          '201': {
            description: 'created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
          '422': {
            description: 'invalid',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } },
          },
        },
      },
    },
    '/pets/{petId}': {
      parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'integer' } }],
      get: {
        operationId: 'getPet',
        tags: ['pets'],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
      delete: {
        operationId: 'deletePet',
        tags: ['pets'],
        deprecated: true,
        responses: { '204': { description: 'deleted' } },
      },
    },
    '/pets/{petId}/photo': {
      put: {
        operationId: 'uploadPhoto',
        tags: ['pet media'],
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                  caption: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '2XX': { description: 'ok', content: { 'text/plain': { schema: { type: 'string' } } } },
        },
      },
    },
    '/categories': {
      get: {
        operationId: 'listCategories',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Category' } },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      PetStatus: { type: 'string', enum: ['available', 'pending', 'sold'] },
      NewPet: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          status: { $ref: '#/components/schemas/PetStatus' },
          vaccinated: { type: 'boolean', default: false },
          tag: { type: ['string', 'null'] },
        },
      },
      Pet: {
        allOf: [
          { $ref: '#/components/schemas/NewPet' },
          {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'integer' },
              category: { $ref: '#/components/schemas/Category' },
            },
          },
        ],
      },
      Category: {
        type: 'object',
        required: ['name', 'children'],
        properties: {
          name: { type: 'string' },
          children: { type: 'array', items: { $ref: '#/components/schemas/Category' } },
        },
      },
      Problem: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string' },
          details: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
} as const;
