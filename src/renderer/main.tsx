import React,{useState,useEffect,useRef,useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import type {AppState,AppAction,DesktopAPI,Session} from '../shared/types';
import './style.css';
declare global {interface Window {desktop:DesktopAPI}}

function Icon({name}:{name:string}){
  const paths:Record<string,React.ReactNode>={
    close:<path d="m6 6 12 12M18 6 6 18"/>,bookmark:<path d="M6 4h12v17l-6-4-6 4z"/>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3z"/></>,
    chat:<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 3-2z"/>,
    arrow:<path d="m7 17 10-10M7 7h10v10"/>,send:<path d="m5 12 7-7 7 7M12 5v15"/>,
    back:<path d="m14 5-7 7 7 7"/>,book:<><path d="M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3zM12 6v16"/></>,
  };
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.arrow}</svg>;
}
function Goose(){return <svg className="goose" viewBox="0 0 80 90" aria-hidden="true"><path d="M70 82c-17-23-5-35-15-53C48 16 29 18 25 31l-16 7 18 6c6 5 14 3 19 0-3 10-12 22-12 38"/><path d="m9 38 17 0"/><circle cx="33" cy="31" r="1.3"/></svg>}
function Fold({text,label}:{text:string;label:string}){
  const [expanded,setExpanded]=useState(false),[overflow,setOverflow]=useState(false);const ref=useRef<HTMLParagraphElement>(null);
  useLayoutEffect(()=>{const el=ref.current;if(!el)return;const measure=()=>{setOverflow(el.scrollHeight>parseFloat(getComputedStyle(el).lineHeight)*3+2);};measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();},[text,expanded]);
  return <div className="fold"><p ref={ref} className={expanded?'':'clamped'}>{text}</p>{overflow&&<button className="text-button expand" aria-label={`${expanded?'收起':'展开'}${label}`} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'收起':'展开'} <span aria-hidden="true">{expanded?'⌃':'⌄'}</span></button>}</div>;
}
function App(){
  const [state,setState]=useState<AppState|null>(null),[page,setPage]=useState<'reader'|'library'|'settings'>('reader');
  const [error,setError]=useState(''),[talk,setTalk]=useState(false),[copied,setCopied]=useState(false);
  const [codexPath,setCodexPath]=useState(''),[model,setModel]=useState('');
  const [draftText,setDraftText]=useState('');const localDrafts=useRef(new Map<string,string>());
  const inputRef=useRef<HTMLTextAreaElement>(null);const previousCapture=useRef('');
  useEffect(()=>{const apply=(next:AppState)=>{if(next.session?.capture.id&&next.session.capture.id!==previousCapture.current){const id=next.session.capture.id;previousCapture.current=id;if(!localDrafts.current.has(id))localDrafts.current.set(id,next.session.draft);setDraftText(localDrafts.current.get(id)||'');setPage('reader');setTalk(next.session.conversation.length>0||!!localDrafts.current.get(id));setError('');}setState(next);};const off=window.desktop.onState(apply);window.desktop.getState().then(apply).catch(e=>setError(e.message));return off;},[]);
  useEffect(()=>{if(state){setCodexPath(state.settings.codexPath);setModel(state.settings.model);}},[state?.settings.codexPath,state?.settings.model]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')void act({type:'close'});};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useLayoutEffect(()=>{const main=document.querySelector('main');const content=document.querySelector('.content');const header=document.querySelector('header');if(!main||!content||!header)return;let timer:ReturnType<typeof setTimeout>;const measure=()=>{clearTimeout(timer);timer=setTimeout(()=>{const css=getComputedStyle(main);void window.desktop.action({type:'resize',height:content.getBoundingClientRect().height+parseFloat(css.paddingTop)+parseFloat(css.paddingBottom)+header.getBoundingClientRect().height+2}).catch(()=>{});},40);};const observer=new ResizeObserver(measure);observer.observe(content);measure();return()=>{clearTimeout(timer);observer.disconnect();};},[!!state]);
  async function act(action:AppAction){setError('');try{await window.desktop.action(action);}catch(e){setError(e instanceof Error?e.message:String(e));}}
  if(!state)return <div className="starting">正在打开…{error}</div>;
  const session=state.session;
  const openTalk=()=>{setTalk(true);requestAnimationFrame(()=>inputRef.current?.focus());};
  const send=async()=>{
    if(!session||session.discussing||session.status==='loading'||!draftText.trim())return;
    const id=session.capture.id,text=draftText;setError('');localDrafts.current.set(id,'');setDraftText('');
    try{await window.desktop.action({type:'discuss',captureId:id,text});}catch(e){setError(e instanceof Error?e.message:String(e));if(!localDrafts.current.get(id)){localDrafts.current.set(id,text);if(previousCapture.current===id)setDraftText(text);}}
  };
  function reader(s:Session){
    const c=s.capture.context;const range=c.sentenceRange||{start:0,end:c.text.length};
    const before=c.text.slice(range.start,c.selectionStart),after=c.text.slice(c.selectionEnd,range.end);
    return <>
      <section className="expression">
        <div className="word-line"><h1>{s.capture.selectedText}</h1><button className={`icon-button save ${s.saved?'saved':''}`} title={s.saved?'取消收藏':'收藏'} aria-label={s.saved?'取消收藏':'收藏'} aria-pressed={s.saved} onClick={()=>void act({type:'toggle-save',captureId:s.capture.id})}><Icon name="bookmark"/></button></div>
        {s.explanation?<p className="meaning">{s.explanation.meaning}</p>:s.status==='loading'?<div className="loading" role="status"><span/>正在理解语境…</div>:null}
        <Goose/>
      </section>
      <section className="original" aria-label="原文"><p>{before}<mark>{s.capture.selectedText}</mark>{after}</p></section>
      {s.explanation?.sentenceTranslation&&<section className="translation"><Fold key={`${s.capture.id}-translation`} text={s.explanation.sentenceTranslation} label="译文"/></section>}
      {(s.error||s.status==='error')&&<div className="error" role="alert"><p>{s.error||'暂时无法解释这段文字。'}</p>{!s.explanation&&<><button className="text-button" onClick={()=>void act({type:'retry',captureId:s.capture.id})}>重试</button> <button className="text-button" onClick={()=>setPage('settings')}>检查连接</button></>}</div>}
      {s.status==='idle'&&!s.explanation&&<button className="text-button" onClick={()=>void act({type:'retry',captureId:s.capture.id})}>解释这段文字</button>}
      {s.explanation?.contextNote&&<section className="context"><h2>Context</h2><Fold key={`${s.capture.id}-context`} text={s.explanation.contextNote} label="Context"/></section>}
      {!!s.explanation?.limitations.length&&<p className="limitations">{s.explanation.limitations.join(' ')}</p>}
      <section className="discussion">
        <div className="discussion-bar"><button className="text-button discussion-toggle" onClick={()=>talk?setTalk(false):openTalk()} aria-expanded={talk}><Icon name="chat"/>{talk?'收起讨论':'继续讨论…'}</button>{s.status==='loading'&&<button className="text-button muted" onClick={()=>void act({type:'cancel',captureId:s.capture.id})}>停止</button>}</div>
        {talk&&<div className="conversation">
          {s.conversation.map(m=><div key={m.id} className={`message ${m.role}`}><span>{m.role==='user'?'你':'Context First'}</span><p>{m.text}</p></div>)}
          {s.discussing&&<div className="message assistant" aria-live="polite"><span>Context First</span><p>{s.partialReply||'正在思考…'}</p><button className="text-button" onClick={()=>void act({type:'cancel',captureId:s.capture.id})}>停止</button></div>}
          {s.discussionError&&<div className="error" role="alert">{s.discussionError} <button className="text-button" onClick={()=>void act({type:'discuss',captureId:s.capture.id,text:'',retry:true})}>重试回复</button></div>}
          <div className="composer"><textarea ref={inputRef} aria-label="继续追问" placeholder="关于这个表达，还想了解什么？" value={draftText} maxLength={4000} onChange={e=>{const text=e.target.value;localDrafts.current.set(s.capture.id,text);setDraftText(text);void act({type:'draft',captureId:s.capture.id,text});}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><button className="send" aria-label="发送" disabled={s.discussing||s.status==='loading'||!draftText.trim()} onClick={()=>void send()}><Icon name="send"/></button></div>
        </div>}
      </section>
      {(s.capture.source.title||s.capture.source.url||s.capture.source.documentUri)&&<button className="source" onClick={()=>void act({type:'open-source',captureId:s.capture.id})}><Icon name="arrow"/><span>{s.capture.source.title||s.capture.source.url||s.capture.source.documentUri}{s.capture.source.lineStart?` · ${s.capture.source.lineStart}`:''}</span></button>}
    </>;
  }
  return <div className="app"><header className="chrome"><div className="brand">context <b>first</b><span className="brand-dot"/></div><nav><button className={`icon-button ${page==='library'?'active':''}`} title="收藏" aria-label="查看收藏" onClick={()=>setPage(page==='library'?'reader':'library')}><Icon name="book"/></button><button className={`icon-button ${page==='settings'?'active':''}`} title="设置" aria-label="设置" onClick={()=>setPage(page==='settings'?'reader':'settings')}><Icon name="settings"/></button><button className="icon-button" title="关闭浮窗" aria-label="关闭浮窗" onClick={()=>void act({type:'close'})}><Icon name="close"/></button></nav></header>
    <main><div className="content">{error&&<div className="error" role="alert">{error}</div>}
      {state.notice?.startsWith('测试模式')&&<p className="test-notice">{state.notice}</p>}
      {page==='reader'&&(session?reader(session):<section className="welcome"><div className="welcome-goose"><Goose/></div><p className="eyebrow">IN CONTEXT</p><h1>选中表达，<br/>读懂语境。</h1><p>在浏览器或 VS Code 中选中文字，<br/>用快捷键打开解释。</p><button className="primary" onClick={()=>setPage('settings')}>连接采集扩展 <Icon name="arrow"/></button><button className="text-button try-example" onClick={()=>void act({type:'example'})}>试一段示例</button><span className="quiet-note">原句、词义和你的每一次追问。</span></section>)}
      {page==='library'&&<section className="library"><div className="section-title"><h1>收藏</h1><span>{state.library.length} 条语境</span></div>{state.library.length>0&&<button className="text-button export" onClick={()=>void act({type:'export'})}>导出 JSON ↗</button>}{!state.library.length?<p className="empty">遇到想留下的表达，点击书签。<br/>它的原句和语境会一起保存。</p>:state.library.map(entry=><article key={entry.id} className="entry"><button onClick={()=>{setPage('reader');void act({type:'open-entry',id:entry.id});}}><strong>{entry.capture.selectedText}</strong><span>{entry.explanation?.meaning||entry.capture.context.text}</span><small>{entry.capture.source.title||'来源未记录'}</small></button><button className="icon-button" aria-label={`删除收藏 ${entry.capture.selectedText}`} title="删除收藏" onClick={()=>void act({type:'delete-entry',id:entry.id})}><Icon name="close"/></button></article>)}</section>}
      {page==='settings'&&<section className="settings"><h1>连接与设置</h1><h2>采集扩展</h2><p>在浏览器和 VS Code 扩展中填写这台电脑的配对码。</p><label>配对码<div className="token-row"><input aria-label="配对码" readOnly value={state.connection.token} onFocus={e=>e.currentTarget.select()}/><button className="secondary" onClick={()=>{void act({type:'copy-token'});setCopied(true);}}> {copied?'已复制':'复制'}</button></div></label><p className="small">本机端口 {state.connection.port} · 默认快捷键 Alt + Shift + D</p><h2>AI 解释</h2><p>自动连接本机已登录的 Codex，使用默认模型，无需填写配置。选中的文本与附近原文会发送给 Codex。</p><details className="advanced-settings"><summary>高级设置（可选）</summary><form onSubmit={e=>{e.preventDefault();void act({type:'settings',settings:{codexPath,model}});}}><label>Codex 程序路径 <span className="muted">留空自动查找</span><input value={codexPath} onChange={e=>setCodexPath(e.target.value)} placeholder="自动查找已安装的 Codex"/></label><label>模型 <span className="muted">可留空，使用 Codex 默认设置</span><input value={model} onChange={e=>setModel(e.target.value)} placeholder="默认模型"/></label><button className="primary" type="submit">保存设置</button><button className="text-button reset-auto" type="button" onClick={()=>void act({type:'settings',settings:{codexPath:'',model:''}})}>恢复自动连接</button></form></details>{state.notice&&!state.notice.startsWith('测试模式')&&<p role="status" className="small">{state.notice}</p>}<p className="quiet-note">收藏保存在本机，可从收藏页导出。</p></section>}
    </div></main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
