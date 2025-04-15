// Simple TypeScript types for JSON Schema (no dependency)
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  format?: string;
  additionalProperties?: boolean;
  // Custom SQLite extensions
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
  // Standard JSON Schema fields we'll use
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

export function jsonSchemaToSql(schema: TableSchema): SQLiteTableDefinition {
  const columnDefinitions: string[] = [];
  const constraints: string[] = [];
  const indexStatements: string[] = [];

  // Map JSON Schema types to SQLite types
  function mapType(propSchema: JSONSchema): string {
    // Handle union types (e.g., ["string", "null"])
    const type = Array.isArray(propSchema.type)
      ? propSchema.type.find((t) => t !== "null") || "string"
      : propSchema.type || "string";

    // Map based on type and format
    if (type === "integer" || propSchema.format === "integer") return "INTEGER";
    if (type === "number") return "REAL";
    if (type === "boolean") return "BOOLEAN";
    if (type === "object" || type === "array") return "TEXT"; // Store as JSON
    if (propSchema.format === "date-time" || propSchema.format === "date")
      return "TIMESTAMP";

    // Default to TEXT for strings and anything else
    return "TEXT";
  }

  // Format default values for SQLite
  function formatDefaultValue(value: any, type: string): string {
    if (value === undefined || value === null) return "NULL";
    if (typeof value === "string") return `'${value}'`;
    if (typeof value === "object") return `'${JSON.stringify(value)}'`;
    return value.toString();
  }

  // Process each property in the schema
  for (const [propName, propSchema] of Object.entries(schema.properties)) {
    const sqliteType = mapType(propSchema);
    let columnDef = `"${propName}" ${sqliteType}`;

    // Add constraints directly to column
    if (propSchema["x-dorm-primary-key"]) {
      columnDef += " PRIMARY KEY";
      if (propSchema["x-dorm-auto-increment"] && sqliteType === "INTEGER") {
        columnDef += " AUTOINCREMENT";
      }
    }

    if (propSchema["x-dorm-unique"]) {
      columnDef += " UNIQUE";
    }

    if (schema.required?.includes(propName)) {
      columnDef += " NOT NULL";
    }

    if (propSchema["x-dorm-default"] !== undefined) {
      columnDef += ` DEFAULT ${formatDefaultValue(
        propSchema["x-dorm-default"],
        sqliteType,
      )}`;
    }

    columnDefinitions.push(columnDef);

    // Handle references (foreign keys)
    if (propSchema["x-dorm-references"]) {
      const ref = propSchema["x-dorm-references"];
      let constraintDef = `FOREIGN KEY ("${propName}") REFERENCES "${ref.table}"("${ref.column}")`;

      if (ref.onDelete) constraintDef += ` ON DELETE ${ref.onDelete}`;
      if (ref.onUpdate) constraintDef += ` ON UPDATE ${ref.onUpdate}`;

      constraints.push(constraintDef);
    }

    // Handle indexes
    if (propSchema["x-dorm-index"]) {
      const indexName =
        typeof propSchema["x-dorm-index"] === "string"
          ? propSchema["x-dorm-index"]
          : `idx_${schema.$id}_${propName}`;

      indexStatements.push(
        `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${schema.$id}"("${propName}");`,
      );
    }
  }

  // Combine column definitions and constraints
  const allDefinitions = [...columnDefinitions, ...constraints];

  // Create the final CREATE TABLE statement
  const createTableStatement = `CREATE TABLE IF NOT EXISTS "${schema.$id}" (
    ${allDefinitions.join(",\n  ")}
  );`;

  return {
    createTableStatement,
    indexStatements,
  };
}
