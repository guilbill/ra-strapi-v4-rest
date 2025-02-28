import { fetchUtils, DataProvider } from "ra-core";
import qs from "qs";

const POPULATE_ALL = "populate=*";

const OPERATORS = {
  _gte: "$gte",
  _lte: "$lte",
  _neq: "$ne",
  _q: "$contains",
};

/**
 * Turn Strapi arrays to React Admin arrays.
 * @param {Array} array Strapi resources / components arrays
 * @returns {Array} React Admin array of objects
 */
const strapiArrayToRa = (array: any) =>
    array.map(
        (object: any) => 
            object.documentId ? strapiObjectToRa(object) 
            : strapiAttributesToRa(object)
    );


/**
 * Turn Strapi objects to React Admin objects.
 * @param {Object} object Strapi object
 * @returns {Object} React Admin objects
 */
const strapiObjectToRa = (object: any) => {
  const { documentId, id, blocks, ...attributes } = object;
  return {
    id: documentId,
    ref: id,
    ...strapiAttributesToRa(attributes),
  };
};

/**
 * Check the attribute type and turn in a React Admin
 * object property.
 * @param {Object} attributes Strapi data attributes
 * @returns {Object} React Admin object
 */
const strapiAttributesToRa = (attributes: any) => {
  Object.keys(attributes).forEach((key: string) => {
    const data = attributes[key];
    if (!data) return;
    // it's an strapi object
    if (data.documentId) {
      attributes[key] = strapiObjectToRa(data);
    }
    // it's an array of strapi objects
    if (Array.isArray(data) && data.length > 0 && data[0]?.documentId) {
      attributes[key] = data.map((item: any) => strapiObjectToRa(item));
    }
  });

  return attributes;
};


/**
 * Turn React Admin filters in Strapi equivalent query object.
 * @param {Object} raFilter React Admin filters
 * @returns {Object} Equivalent filters to add in query string
 */
const raFilterToStrapi = (raFilter: any) => {
  if (!raFilter) return null;
  let filters: any = {};

  Object.keys(raFilter).forEach((key) => {
    if (typeof raFilter[key] === "object") {
      return (filters[key] = raFilterToStrapi(raFilter[key]));
    }

    const operator = OPERATORS[key.slice(-4) as keyof typeof OPERATORS];
    if (key.slice(-2) === "_q") {
      const field = key.slice(0, -2);
      filters[field] = {
        $containsi: raFilter[key],
      };
    } else if (key === "id") {
      filters.componentId = {
        $in: raFilter.id,
      };
    } else if (operator) {
      const field = key.slice(0, -4);
      filters[field] = {
        [operator]: raFilter[key],
      };
    } else {
      filters[key] = {
        $eq: raFilter[key],
      };
    }
  });

  return filters;
};


const curateData = (data: any) => {
    const { id, ref, createdAt, publishedAt, updatedAt, documentId, ...curatedData} = data;
    return curatedData;
}

/**
 * Turn React Admin params in Strapi equivalent request body.
 * @param {Object} params React Admin params
 * @returns {Object} Equivalent body to add in request body.
 */
const raToStrapiObj = (params: any) => {
    const curatedData = curateData(params.data);
    for (const key of Object.keys(curatedData)) {
        if (curatedData[key]?.documentId) {
            curatedData[key] = curatedData[key].id;
        }
        if (Array.isArray(curatedData[key])) {
            curatedData[key] = curatedData[key].map((item: any) => item.id);
        }
    }
  return curatedData;
};


/**
 * Maps react-admin queries to a Strapi V5 REST API
 *
 * @example
 *
 * import * as React from "react";
 * import { Admin, Resource } from 'react-admin';
 * import { strapiRestProvider } from 'ra-strapi-v5-rest';
 *
 * import { PostList } from './posts';
 *
 * const App = () => (
 *     <Admin dataProvider={strapiRestProvider('http://path.to.my.api/')}>
 *         <Resource name="posts" list={PostList} />
 *     </Admin>
 * );
 *
 * export default App;
 */

export const strapiRestProvider = (
  apiUrl: string,
  httpClient = fetchUtils.fetchJson,
): DataProvider => ({
  getList: (resource, params) => {
    const page = params.pagination?.page;
    const perPage = params.pagination?.perPage;
    const field = params.sort?.field;
    const order = params.sort?.order;

    const query = {
      sort: [`${field}:${order}`],
      pagination: {
        page,
        pageSize: perPage,
      },
      filters: raFilterToStrapi(params.filter),
    };

    const queryStringify = qs.stringify(query, {
      encodeValuesOnly: true,
    });

    const url = `${apiUrl}/${resource}?${POPULATE_ALL}&${queryStringify}`;

    return httpClient(url, {}).then(({ json }) => {
      return {
        data: strapiArrayToRa(json.data),
        total: json.meta.pagination.total,
      };
    });
  },

  getOne: (resource, params) =>
    httpClient(`${apiUrl}/${resource}/${params.id}?${POPULATE_ALL}`).then(
      ({ json }) => ({
        data: strapiObjectToRa(json.data),
      }),
    ),

  getMany: (resource, params) => {
    const query = {
      filters: {
        documentId: {
          $in: params.ids,
        },
      },
    };
    const queryStringify = qs.stringify(query, {
      encodeValuesOnly: true,
    });
    const url = `${apiUrl}/${resource}?${queryStringify}`;

    return httpClient(url).then(({ json }) => {
      return ({
      data: strapiArrayToRa(json.data),
      total: json.meta.total,
    })});
  },

  getManyReference: (resource, params) => {
    const { page, perPage } = params.pagination;
    const { field, order } = params.sort;
    
    const query = {
      sort: [`${field}:${order}`],
      pagination: {
        page,
        pageSize: perPage,
      },
      filters: raFilterToStrapi({
        ...params.filter,
        [params.target.split(".").join("][")]: params.id,
      }),
    };

    const queryStringify = qs.stringify(query, {
      encodeValuesOnly: true,
    });
    const url = `${apiUrl}/${resource}?${POPULATE_ALL}&${queryStringify}`;

    return httpClient(url, {}).then(({ json }) => {

      return ({
      data: strapiArrayToRa(json.data),
      total: json.meta.pagination.total,
    })});
  },

  update: (resource, params) => {
    const body = JSON.stringify({data: raToStrapiObj(params)});

    return httpClient(`${apiUrl}/${resource}/${params.id}`, {
      method: "PUT",
      body,
    }).then(({ json }) => ({ data: strapiObjectToRa(json.data) }));
  },

  updateMany: (resource, params) =>
    Promise.all(
      params.ids.map((id) =>
        httpClient(`${apiUrl}/${resource}/${id}`, {
          method: "PUT",
          body: JSON.stringify({ data: params.data }),
        }),
      ),
    ).then((responses) => ({
      data: responses.map(({ json }) => json.data.id),
    })),

  create: (resource, params) => {
    const body = raToStrapiObj(params);

    return httpClient(`${apiUrl}/${resource}`, {
      method: "POST",
      body,
    }).then(({ json }) => ({ data: strapiObjectToRa(json.data) }));
  },

  delete: (resource, params) =>
    httpClient(`${apiUrl}/${resource}/${params.id}`, {
      method: "DELETE",
      headers: new Headers({
        "Content-Type": "text/plain",
      }),
    }).then(({ json }) => ({ data: json })),

  deleteMany: (resource, params) =>
    Promise.all(
      params.ids.map((id) =>
        httpClient(`${apiUrl}/${resource}/${id}`, {
          method: "DELETE",
          headers: new Headers({
            "Content-Type": "text/plain",
          }),
        }),
      ),
    ).then((responses) => ({
      data: responses.map(({ json }) => json.data.id),
    })),
});
