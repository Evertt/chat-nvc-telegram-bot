// deno-lint-ignore-file no-explicit-any
interface JSON {
  decycle(object: any, replacer?: any): any;
  retrocycle($: any): any;
}
