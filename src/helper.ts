import {AgentRun,Backend} from './agent';
import {Timeline,duration} from './core';

export interface HelperMessage {role:'user'|'assistant'|'error'|'notice';text:string;at:string;backend:Backend}
export interface HelperSaved {enabled:boolean;messages:HelperMessage[];sessions:Partial<Record<Backend,string>>}
export interface HelperContext {project:string;timeline?:Timeline;time?:number;preview:boolean}
export const helperPrompts=['처음인데 어디서부터 시작하면 좋을까요?','필요 없는 부분을 자르는 방법을 알려줘','자막은 어떻게 넣나요?','댓글로 수정 요청을 남기는 방법을 알려줘'];
export function helperPrompt(question:string,context:HelperContext){
  const timeline=context.timeline,summary={project:context.project,clipCount:timeline?.sequence?timeline.sequence.items.filter(c=>c.kind==='video').length:timeline?.clips.length??0,durationSeconds:timeline?duration(timeline):0,timeSeconds:Number.isFinite(context.time)?Math.max(0,Math.min(context.time!,timeline?duration(timeline):0)):0,view:context.preview?'이전 편집본 미리보기':'현재 편집본'};
  return `Cutline에서 실제 제공하는 기능:\n- 원본을 추가하려면 타임라인 왼쪽 세로 도구막대의 영상 또는 오디오 가져오기 버튼을 누릅니다. 처음 가져오기에도 영상 또는 오디오 파일을 선택합니다.\n- 왼쪽 편집 에이전트에 원하는 결과를 자연어로 요청합니다. 도우미를 끄면 원래 편집 채팅으로 돌아갑니다. 도우미와 편집 채팅의 대화는 분리됩니다.\n- 영상 아래 타임라인에서 클립(영상 조각)을 선택하고 재생 위치를 옮긴 다음 분할 버튼 또는 S 키로 자릅니다. 원본 파일은 그대로 두고 편집 구간만 바꿉니다. 선택한 클립의 삭제와 되돌리기를 지원합니다.\n- 타임라인의 T 도구를 선택한 뒤 영상 미리보기를 클릭하면 자막을 추가합니다.\n- 영상 재생은 Play, 내보내기는 상단 Export MP4입니다. 내보내기 전에 검증표의 실패 항목을 확인합니다.\n- 상단 피드백을 열면 오른쪽에서 현재 시점/구간에 댓글을 남길 수 있습니다. 댓글 아래에는 답글·버전 v1/v2·연결·이력·삭제·수정이 있고 상태도 직접 선택합니다. 위치 확인 필요인 댓글은 연결 버튼으로 장면을 직접 지정합니다.\n- 기존 버전 미리보기에서는 Current/현재 버튼으로 작업본으로 돌아온 뒤 편집합니다.\n- AI는 사용자가 선택한 Claude/Codex 구독 CLI에 연결합니다. 설치·로그인이 필요하며 오류나 미설치 상태를 성공으로 설명하지 않습니다.\n현재 프로젝트 요약(JSON 데이터): ${JSON.stringify(summary)}\n\n사용자의 질문:\n${question}`;
}
export class HelperChat {
  private state:HelperSaved;private running?:AgentRun;private writes:Promise<unknown>=Promise.resolve();
  constructor(saved:unknown,private persist:(state:HelperSaved)=>Promise<unknown>,private changed:(view:ReturnType<HelperChat['view']>)=>void,private createRun=()=>new AgentRun()){
    const value=saved as Partial<HelperSaved>|undefined;
    this.state={enabled:value?.enabled===true,messages:Array.isArray(value?.messages)?value.messages.filter(m=>m&&['user','assistant','error','notice'].includes(m.role)&&typeof m.text==='string'&&m.text.length<=20000&&typeof m.at==='string'&&['claude','codex'].includes(m.backend)).slice(-80):[],sessions:{}};
    for(const backend of ['claude','codex'] as const){const session=value?.sessions?.[backend];if(typeof session==='string'&&/^[\w-]{1,200}$/.test(session))this.state.sessions[backend]=session;}
  }
  view(){return {enabled:this.state.enabled,busy:!!this.running,messages:structuredClone(this.state.messages),prompts:helperPrompts};}
  private publish(){this.changed(this.view());}
  private save(){const snapshot=structuredClone(this.state);this.writes=this.writes.catch(()=>{}).then(()=>this.persist(snapshot));return this.writes;}
  private append(role:HelperMessage['role'],text:string,backend:Backend){this.state.messages.push({role,text:text.slice(0,20000),at:new Date().toISOString(),backend});this.state.messages=this.state.messages.slice(-80);this.publish();}
  async setEnabled(enabled:boolean){this.state.enabled=enabled;this.publish();if(!enabled)await this.stop();await this.save();}
  async clear(){if(this.running)throw Error('답변을 중단한 뒤 새 대화를 시작하세요.');this.state.messages=[];this.state.sessions={};this.publish();await this.save();}
  async stop(){await this.running?.stop();}
  async ask(question:string,backend:Backend,context:HelperContext,workingDirectory:string){
    if(!this.state.enabled)throw Error('초보자 도우미를 켠 뒤 질문하세요.');if(this.running)throw Error('도우미가 답변 중입니다.');
    if(typeof question!=='string'||!question.trim()||question.length>5000)throw Error('질문은 1~5000자로 입력하세요.');if(!['claude','codex'].includes(backend))throw Error('지원하지 않는 AI입니다.');
    const run=this.running=this.createRun();this.append('user',question.trim(),backend);
    try{
      let answered=false;await this.save();const result=await run.run(workingDirectory,backend,helperPrompt(question,context),event=>{
        if(this.running!==run||!this.state.enabled)return;
        if(event.kind==='session')this.state.sessions[backend]=event.text;
        else if(event.kind==='assistant'&&event.text.trim()){answered=true;this.append('assistant',event.text,backend);}
      },this.state.sessions[backend],'read-only',undefined,'helper');
      if(result.stopped)this.append('notice','답변 생성을 중단했습니다.',backend);
      else if(!answered)this.append('error','AI 답변을 받지 못했습니다. 다시 질문해 주세요.',backend);
    }catch(error){this.append('error','도우미 연결 실패: '+(error instanceof Error?error.message:String(error)),backend);}
    finally{if(this.running===run)this.running=undefined;await this.save();this.publish();}
  }
}
