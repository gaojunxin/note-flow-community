import contract from './contracts/syncEntityFields.json' with {type:'json'}

/** Field shapes only. Required fields, ownership and date conversion stay at their domain boundary.
 * Missing values are allowed for patches; explicit null is allowed only by nullable rules.
 * Unknown fields are retained for forward compatibility. No value is coerced or rewritten.
 */
export function assertEntityWriteFields(entityType:string,entity:unknown): asserts entity is Record<string,unknown> {
  if(!entity||typeof entity!=='object'||Array.isArray(entity))throw new Error('同步实体必须是对象')
  const fields={...contract.common,...(contract.entities as Record<string,Record<string,string>>)[entityType]}
  for(const [field,rule] of Object.entries(fields)){
    const value=(entity as Record<string,unknown>)[field]
    if(value===undefined)continue
    const valid=rule==='boolean'?typeof value==='boolean'
      :rule==='version'?typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=2147483647
      :rule.startsWith('nullable_')&&value===null?true
      :typeof value==='string'&&Boolean(value.trim())
    if(!valid)throw new Error(`同步字段 ${field} 不符合 ${rule} 契约`)
  }
}
