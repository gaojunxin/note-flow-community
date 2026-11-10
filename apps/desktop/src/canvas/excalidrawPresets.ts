export interface CanvasCreationPreset {
  id:string
  label:string
  description:string
  badge:string
  defaultTitle:string
  initialDocument:()=>string
}

type ElementSeed={id:string;type:'rectangle'|'ellipse'|'text';x:number;y:number;width:number;height:number;text?:string;backgroundColor?:string;strokeColor?:string}

const element=(value:ElementSeed,index:number)=>({
  id:value.id,type:value.type,x:value.x,y:value.y,width:value.width,height:value.height,angle:0,
  strokeColor:value.strokeColor||'#1b4332',backgroundColor:value.backgroundColor||'transparent',fillStyle:'solid',
  strokeWidth:2,strokeStyle:'solid',roughness:value.type==='text'?0:1,opacity:100,groupIds:[],frameId:null,index:`a${index}`,
  roundness:value.type==='rectangle'?{type:3}:null,seed:1200+index,version:1,versionNonce:5200+index,isDeleted:false,
  boundElements:null,updated:1,link:null,locked:false,
  ...(value.type==='text'?{fontSize:22,fontFamily:5,text:value.text||'',textAlign:'center',verticalAlign:'middle',containerId:null,originalText:value.text||'',autoResize:true,lineHeight:1.25}:{}),
})

export function createExcalidrawPresetDocument(elements:ElementSeed[]=[]){
  return JSON.stringify({type:'excalidraw',version:2,source:'note-flow',elements:elements.map(element),appState:{viewBackgroundColor:'#ffffff'},files:{}})
}

export const excalidrawCreationPresets:readonly CanvasCreationPreset[]=Object.freeze([
  {id:'blank',label:'自由画布',description:'从空白空间开始，自由绘制和连接',badge:'自由',defaultTitle:'未命名画布',initialDocument:()=>createExcalidrawPresetDocument()},
  {id:'brainstorm',label:'头脑风暴',description:'围绕中心议题快速发散和归类想法',badge:'灵感',defaultTitle:'头脑风暴',initialDocument:()=>createExcalidrawPresetDocument([
    {id:'brainstorm-center',type:'ellipse',x:360,y:220,width:240,height:120,backgroundColor:'#d8f3dc'},
    {id:'brainstorm-title',type:'text',x:405,y:260,width:150,height:34,text:'中心议题'},
    {id:'brainstorm-left',type:'rectangle',x:80,y:100,width:190,height:92,backgroundColor:'#fff3bf'},
    {id:'brainstorm-left-text',type:'text',x:117,y:129,width:116,height:32,text:'想法 A'},
    {id:'brainstorm-right',type:'rectangle',x:690,y:100,width:190,height:92,backgroundColor:'#dbe4ff'},
    {id:'brainstorm-right-text',type:'text',x:727,y:129,width:116,height:32,text:'想法 B'},
  ])},
  {id:'cards',label:'卡片白板',description:'用分区卡片整理素材、观点与行动项',badge:'卡片',defaultTitle:'卡片白板',initialDocument:()=>createExcalidrawPresetDocument([
    {id:'cards-title',type:'text',x:80,y:50,width:220,height:38,text:'卡片白板'},
    {id:'card-1',type:'rectangle',x:80,y:130,width:230,height:150,backgroundColor:'#fff3bf'},
    {id:'card-1-text',type:'text',x:115,y:180,width:160,height:36,text:'素材'},
    {id:'card-2',type:'rectangle',x:350,y:130,width:230,height:150,backgroundColor:'#d8f3dc'},
    {id:'card-2-text',type:'text',x:385,y:180,width:160,height:36,text:'观点'},
    {id:'card-3',type:'rectangle',x:620,y:130,width:230,height:150,backgroundColor:'#dbe4ff'},
    {id:'card-3-text',type:'text',x:655,y:180,width:160,height:36,text:'行动'},
  ])},
  {id:'sketch',label:'自由草图',description:'带轻量提示的空白草图，适合手绘推演',badge:'草图',defaultTitle:'自由草图',initialDocument:()=>createExcalidrawPresetDocument([
    {id:'sketch-hint',type:'text',x:70,y:55,width:320,height:30,text:'在这里画下第一笔…',strokeColor:'#82948c'},
  ])},
])
