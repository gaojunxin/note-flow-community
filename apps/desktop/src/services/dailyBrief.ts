export type DailyWeather={label:string;temperature?:number;advice:string;detail?:string;updatedAt?:string;source:string}

export {dailyCulture,localDayKey,type DailyCulture} from '@note-flow/core/daily-culture'
const weatherCodes:Record<number,string>={0:'晴',1:'大部晴朗',2:'多云',3:'阴',45:'有雾',48:'雾凇',51:'毛毛雨',53:'毛毛雨',55:'较强毛毛雨',61:'小雨',63:'中雨',65:'大雨',71:'小雪',73:'中雪',75:'大雪',80:'阵雨',81:'阵雨',82:'强阵雨',95:'雷雨',96:'雷雨伴冰雹',99:'强雷雨伴冰雹'}
const position=()=>new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:7000,maximumAge:1800000}))
export async function loadDailyWeather():Promise<DailyWeather>{
  if(!navigator.geolocation)return{label:'天气定位不可用',advice:'可在系统设置中开启定位权限',source:'Open-Meteo'}
  try{
    const {coords}=await position(),url=`https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude.toFixed(4)}&longitude=${coords.longitude.toFixed(4)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`
    const response=await fetch(url);if(!response.ok)throw new Error('weather unavailable')
    const data=await response.json() as {current?:{time?:string;temperature_2m?:number;apparent_temperature?:number;relative_humidity_2m?:number;weather_code?:number;precipitation?:number;wind_speed_10m?:number};daily?:{temperature_2m_max?:number[];temperature_2m_min?:number[]}},current=data.current||{}
    const temperature=current.temperature_2m,description=weatherCodes[current.weather_code??-1]||'天气变化'
    const advice=(current.precipitation||0)>0?'外出记得带伞':temperature!==undefined&&temperature>=30?'注意防晒并及时补水':temperature!==undefined&&temperature<=8?'天气偏冷，注意保暖':'适合按计划安排今天'
    const high=data.daily?.temperature_2m_max?.[0],low=data.daily?.temperature_2m_min?.[0],detail=[high!==undefined&&low!==undefined?`${Math.round(low)}~${Math.round(high)}℃`:'',current.relative_humidity_2m!==undefined?`湿度 ${current.relative_humidity_2m}%`:'',current.wind_speed_10m!==undefined?`风速 ${Math.round(current.wind_speed_10m)} km/h`:''].filter(Boolean).join(' · ')
    return{label:`${description}${temperature===undefined?'':` · ${Math.round(temperature)}℃`}`,temperature,advice,detail,updatedAt:current.time?new Date(current.time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'',source:'Open-Meteo'}
  }catch{return{label:'暂未获取天气',advice:'允许定位后可显示本地天气提示',source:'Open-Meteo'}}
}
