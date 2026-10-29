'use strict';
(() => {
 const root=document.getElementById('research-assistant');
 if(!root)return;
 const toggle=root.querySelector('#assistant-toggle'),panel=root.querySelector('#assistant-panel');
 const close=root.querySelector('#assistant-close'),clear=root.querySelector('#assistant-clear');
 const messages=root.querySelector('#assistant-messages'),form=root.querySelector('#assistant-form');
 const input=root.querySelector('#assistant-question'),send=root.querySelector('#assistant-send');
 const contextLabel=root.querySelector('#assistant-context');
 let history=[];
 try{history=JSON.parse(localStorage.getItem('value-research-assistant')||'[]');if(!Array.isArray(history))history=[];}catch{history=[];}
 history=history.filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string').slice(-20);
 const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // 回答里常见的只有标题、加粗和行内代码。先整体转义再还原成标签，模型输出的 HTML 不会当成页面执行。
 const markup=x=>escape(x)
  .replace(/^#{1,6}[ \t]+(.+)$/gm,'<strong>$1</strong>')
  .replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')
  .replace(/`([^`\n]+)`/g,'<code>$1</code>');
 function current(){
  const view=[...document.querySelectorAll('.view')].find(x=>!x.hidden)?.id||'general';
  const code=document.body.dataset.assistantCode||null,name=document.body.dataset.assistantName||'';
  return {view,code,name};
 }
 function render(){
  const ctx=current();contextLabel.textContent=ctx.code?`正在结合 ${ctx.name||ctx.code}（${ctx.code}）的本地研究档案回答`:'尚未打开具体公司，可询问指标含义或网站用法';
  messages.innerHTML=history.length?history.map(x=>`<div class="assistant-message ${x.role}"><span>${x.role==='user'?'你':'MiniMax M3'}</span><p>${markup(x.content)}</p></div>`).join(''):'<div class="assistant-welcome"><strong>你可以直接问：</strong><button type="button" data-assistant-prompt="ROE 是什么意思？这个数值怎么看？">ROE 怎么看？</button><button type="button" data-assistant-prompt="请用大白话解释当前公司的 WACC 是怎么计算的。">WACC 怎么算？</button><button type="button" data-assistant-prompt="当前公司的经营现金流和净利润说明了什么？">现金流和利润</button></div>';
  messages.scrollTop=messages.scrollHeight;
 }
 function save(){localStorage.setItem('value-research-assistant',JSON.stringify(history.slice(-20)));}
 function open(){panel.hidden=false;toggle.setAttribute('aria-expanded','true');render();setTimeout(()=>input.focus(),0);}
 function shut(){panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}
 toggle.addEventListener('click',()=>panel.hidden?open():shut());close.addEventListener('click',shut);
 clear.addEventListener('click',()=>{history=[];save();render();});
 root.addEventListener('click',e=>{const button=e.target.closest('[data-assistant-prompt]');if(button){input.value=button.dataset.assistantPrompt;form.requestSubmit();}});
 form.addEventListener('submit',async e=>{
  e.preventDefault();const question=input.value.trim();if(!question||send.disabled)return;
  const prior=history.slice(-8);history.push({role:'user',content:question});input.value='';send.disabled=true;send.textContent='回答中…';render();
  const waiting=document.createElement('div');waiting.className='assistant-message assistant waiting';waiting.textContent='正在读取当前页面和研究档案…';messages.appendChild(waiting);messages.scrollTop=messages.scrollHeight;
  try{
   const ctx=current(),response=await fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,code:ctx.code,page:ctx.view,history:prior})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'助手暂时无法回答');
   history.push({role:'assistant',content:data.answer});save();render();
  }catch(err){history.push({role:'assistant',content:`这次没有回答成功：${err.message}`});render();}
  finally{send.disabled=false;send.textContent='发送';}
 });
 input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)shut();});
 window.ResearchAssistant={refreshContext:render};render();
})();
