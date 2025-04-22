declare module "jsonSchemaToSql" {
    export interface JSONSchema {
        type?: string | string[];
        properties?: Record<string, JSONSchema>;
        required?: string[];
        format?: string;
        additionalProperties?: boolean;
        "x-dorm-primary-key"?: boolean;
        "x-dorm-auto-increment"?: boolean;
        "x-dorm-index"?: boolean | string;
        "x-dorm-unique"?: boolean;
        "x-dorm-references"?: {
            table: string;
            column: string;
            onDelete?: "CASCADE" | "SET NULL" | "RESTRICT";
            onUpdate?: "CASCADE" | "SET NULL" | "RESTRICT";
        };
        "x-dorm-default"?: any;
        minimum?: number;
        maximum?: number;
        minLength?: number;
        maxLength?: number;
        pattern?: string;
        description?: string;
    }
    export interface TableSchema {
        $id: string;
        title?: string;
        description?: string;
        type: string;
        properties: Record<string, JSONSchema>;
        required?: string[];
        additionalProperties?: boolean;
    }
    interface SQLiteTableDefinition {
        createTableStatement: string;
        indexStatements: string[];
    }
    export function jsonSchemaToSql(schema: TableSchema): SQLiteTableDefinition;
}
declare module "DORM" {
    import { TableSchema } from "jsonSchemaToSql";
    /**
     * DB Config
     *
     * - Put a version to prefix your DO names. this won't delete previous versions, but they will not be accessible anymore through this ORM
     * - either use schemas, statements, or both to define your tables.
     * - put a secret to make the database accessible only with this authorization header
     */
    export interface DBConfig {
        version?: string;
        schemas?: TableSchema[];
        statements?: string | string[];
    }
    export interface MiddlewareOptions {
        secret?: string;
        prefix?: string;
    }
    interface QueryOptions {
        isRaw?: boolean;
        isTransaction?: boolean;
        /**
         * If mirror is enabled in client but it's not desired to use the mirror for this query, skip performing the mirror-query here
         */
        skipMirror?: boolean;
    }
    type RawQueryResult = {
        columns: string[];
        rows: any[][];
        meta: {
            rows_read: number;
            rows_written: number;
        };
    };
    type ArrayQueryResult<T = Record<string, any>> = T[];
    type QueryResponseType<T extends QueryOptions> = T["isRaw"] extends true ? RawQueryResult : ArrayQueryResult;
    interface QueryResult<T> {
        json: T | null;
        status: number;
        ok: boolean;
    }
    /**
     * factory function that returns:
     * - the query function for raw queries
     * - basic ORM operations (select, insert, update, remove)
     * - the middleware to perform raw queries over api
     */
    export function createClient<T extends DBConfig>(doNamespace: DurableObjectNamespace, dbConfig: T, doConfig?: {
        /**
         * Name of the DO. Defaults to 'root'
         */
        name?: string;
        locationHint?: DurableObjectLocationHint;
        /**
         * Name of a mirror DO (allows to group the data from multiple databases).
         *
         * Will not be used/created when not specified.
         */
        mirrorName?: string;
        /** If passed, mirror-query will  */
        ctx?: ExecutionContext;
        mirrorLocationHint?: DurableObjectLocationHint;
    }): {
        query: <O extends QueryOptions>(sql: string, options?: O, ...params: any[]) => Promise<QueryResult<QueryResponseType<O>>>;
        select: (tableName: string, where?: Record<string, any>, options?: {
            limit?: number;
            offset?: number;
            orderBy?: string | {
                column: string;
                direction?: "ASC" | "DESC";
            }[];
        }) => Promise<QueryResult<RawQueryResult | ArrayQueryResult<Record<string, any>>>>;
        insert: (tableName: string, data: Record<string, any>, returnRecord?: boolean) => Promise<QueryResult<RawQueryResult | ArrayQueryResult<Record<string, any>>>>;
        update: (tableName: string, data: Record<string, any>, where?: Record<string, any>, returnRecord?: boolean) => Promise<QueryResult<RawQueryResult | ArrayQueryResult<Record<string, any>>>>;
        remove: (tableName: string, where?: Record<string, any>, returnRecord?: boolean) => Promise<QueryResult<RawQueryResult | ArrayQueryResult<Record<string, any>>> | {
            json: any;
            status: number;
            ok: boolean;
            error: string;
        }>;
        middleware: (request: Request, options?: MiddlewareOptions) => Promise<Response | undefined>;
    };
    export class DORM {
        private state;
        sql: SqlStorage;
        private initialized;
        private corsHeaders;
        constructor(state: DurableObjectState);
        fetch(request: Request): Promise<Response>;
    }
}
