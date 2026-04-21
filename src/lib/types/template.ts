export interface TemplateVariable {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  default?: string | undefined;
}
