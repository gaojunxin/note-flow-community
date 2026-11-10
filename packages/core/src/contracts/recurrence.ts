/** Stable data shape shared by local readers and optional advanced rule providers. */
export type LunarRepeatRule={frequency:string;interval:number;calendar?:'solar'|'lunar';lunarMonth?:number;lunarDay?:number;lunarLeapMonth?:boolean;repeatFrom?:'due'|'completion'}
