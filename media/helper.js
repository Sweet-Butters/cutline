/* Optional beginner chat. All generated answers arrive from the selected AI backend. */
(function(){
  'use strict';
  class HelperPanel {
    constructor(options){
      this.options=options;this.host=options.host;this.toggle=options.toggle;this.enabled=false;this.busy=false;this.messages=[];
      this.host.innerHTML='<div class="helper-intro"><span>처음 사용하는 분들을 위해</span><strong>편집, 하나씩 같이 알아봐요.</strong><p>용어와 사용법을 쉽게 물어보세요.<br>도우미 대화에서는 영상을 변경하지 않아요.</p></div><div class="helper-messages" role="log" aria-live="polite"></div><div class="helper-suggestions" aria-label="처음 시작할 때 물어보기"></div><form class="helper-form"><textarea aria-label="초보자 도우미에게 질문" placeholder="어떤 부분이 궁금하세요?" maxlength="5000" rows="3" required></textarea><div class="helper-actions"><span class="helper-status">질문을 기다리고 있어요</span><button type="button" class="helper-stop" disabled>중단</button><button type="submit" class="helper-send">질문하기 ↑</button></div></form>';
      this.input=this.host.querySelector('textarea');this.input.value=options.draft||'';this.form=this.host.querySelector('form');this.status=this.host.querySelector('.helper-status');this.log=this.host.querySelector('.helper-messages');
      this.toggle.onclick=()=>{this.setEnabled(!this.enabled);options.request('helperToggle',{enabled:this.enabled});};
      this.input.oninput=()=>options.saveDraft(this.input.value);
      this.input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();this.form.requestSubmit();}};
      this.form.onsubmit=e=>{e.preventDefault();const prompt=this.input.value.trim();if(!prompt||this.busy||!this.enabled)return;this.setBusy(true);options.request('helperSend',{prompt});this.input.value='';options.saveDraft('');};
      this.host.querySelector('.helper-stop').onclick=()=>options.request('helperStop',{});
      this.host.addEventListener('keydown',e=>e.stopPropagation());this.setEnabled(false);
    }
    setEnabled(enabled){this.enabled=enabled;this.host.hidden=!enabled;document.body.classList.toggle('helper-enabled',enabled);this.toggle.setAttribute('aria-checked',String(enabled));this.toggle.querySelector('.helper-toggle-label').textContent=enabled?'켜짐':'꺼짐';this.options.modeChanged?.(enabled);}
    setBusy(value){this.busy=value;this.host.querySelector('.helper-send').disabled=value;this.host.querySelector('.helper-stop').disabled=!value;this.host.querySelectorAll('.helper-suggestions button').forEach(n=>n.disabled=value);this.status.textContent=value?'쉽게 설명할 방법을 생각하고 있어요…':'질문을 기다리고 있어요';this.options.busyChanged(value);}
    receive(message){
      if(message.type==='helperError'){this.setBusy(false);this.status.textContent=message.message;return;}
      if(message.type!=='helperState')return;const state=message.state;this.setEnabled(state.enabled);this.setBusy(state.busy);this.messages=state.messages;
      this.log.replaceChildren();for(const item of state.messages){const row=document.createElement('div');row.className='helper-message '+item.role;const label=document.createElement('small');label.textContent=item.role==='user'?'나':item.role==='assistant'?'도우미 · '+(item.backend==='codex'?'Codex':'Claude'):item.role==='error'?'연결 안내':'안내';const text=document.createElement('p');text.textContent=item.text;row.append(label,text);this.log.append(row);}this.log.scrollTop=this.log.scrollHeight;
      const suggestions=this.host.querySelector('.helper-suggestions');suggestions.replaceChildren();if(!state.messages.length)for(const prompt of state.prompts){const button=document.createElement('button');button.type='button';button.textContent=prompt;button.disabled=state.busy;button.onclick=()=>{this.input.value=prompt;this.form.requestSubmit();};suggestions.append(button);}
    }
    snapshot(){return {enabled:this.enabled,busy:this.busy,messages:this.messages,draft:this.input.value,checked:this.toggle.getAttribute('aria-checked'),visible:!this.host.hidden,status:this.status.textContent,editorVisible:document.getElementById('chat-form').getClientRects().length>0};}
  }
  window.CutlineHelper=HelperPanel;
})();
