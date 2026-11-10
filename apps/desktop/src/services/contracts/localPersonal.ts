export interface FocusSettings { focusMinutes:number;shortBreakMinutes:number;longBreakMinutes:number;roundsBeforeLongBreak:number;autoStartBreak:boolean;version:number }
export interface FocusSession { uid:string;deviceId?:string;taskUid?:string;noteUid?:string;sessionType:string;status:string;plannedSeconds:number;actualSeconds:number;startedAt:string;endedAt:string;syncStatus?:string }
export interface LocalRecording { uid:string;noteUid?:string|null;name:string;durationMs:number;fileSize:number;createdAt:string;localPath:string;sha256:string;syncStatus:string }

