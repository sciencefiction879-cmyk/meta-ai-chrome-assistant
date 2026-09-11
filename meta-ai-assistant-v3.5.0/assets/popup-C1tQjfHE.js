import"./modulepreload-polyfill-B5Qt9EMX.js";import{p as I}from"./normalizer-hPn34PGC.js";async function L(){var a,c,d,e,s,r,n,p,u;(a=document.getElementById("btn-open-full-dashboard"))==null||a.addEventListener("click",()=>{chrome.tabs.create({url:chrome.runtime.getURL("dashboard.html")})}),(c=document.getElementById("dup-range-start"))==null||c.addEventListener("input",()=>m("start")),(d=document.getElementById("dup-range-end"))==null||d.addEventListener("input",()=>m("end")),(e=document.getElementById("dup-custom-count"))==null||e.addEventListener("input",()=>m("count"));const t=document.getElementById("chk-custom-video-ids"),o=document.getElementById("input-custom-video-ids"),i=document.getElementById("popup-range-row");t==null||t.addEventListener("change",()=>{const g=t.checked;o&&(o.style.display=g?"block":"none",g&&o.focus()),i&&(i.style.opacity=g?"0.4":"1",i.style.pointerEvents=g?"none":"auto"),m("start")}),o==null||o.addEventListener("input",()=>m("start")),m("start"),document.querySelectorAll(".btn-dup-preset").forEach(g=>{g.addEventListener("click",y=>{const b=parseInt(y.currentTarget.dataset.count||"1",10),l=document.getElementById("dup-custom-count");l&&(l.value=b.toString()),m("count"),h()})}),(s=document.getElementById("btn-duplicate-chats"))==null||s.addEventListener("click",()=>{h()}),(r=document.getElementById("btn-run-all"))==null||r.addEventListener("click",()=>{chrome.runtime.sendMessage({type:"RUN_EXECUTION",target:"all"},()=>f())}),(n=document.getElementById("btn-pause-all"))==null||n.addEventListener("click",()=>{chrome.runtime.sendMessage({type:"PAUSE_EXECUTION"},()=>f())}),(p=document.getElementById("btn-resume-all"))==null||p.addEventListener("click",()=>{chrome.runtime.sendMessage({type:"RESUME_EXECUTION"},()=>f())}),(u=document.getElementById("btn-download-all"))==null||u.addEventListener("click",()=>{chrome.tabs.create({url:chrome.runtime.getURL("dashboard.html#sec-downloads")})}),f(),setInterval(f,2e3)}function m(t){const o=document.getElementById("chk-custom-video-ids"),i=document.getElementById("input-custom-video-ids"),a=document.getElementById("dup-range-preview");if(o!=null&&o.checked&&i){const n=I(i.value);a&&(a.textContent=n.length>0?`(${n.map(p=>`V${p}`).join(", ")})`:"(None)");return}const c=document.getElementById("dup-range-start"),d=document.getElementById("dup-range-end"),e=document.getElementById("dup-custom-count");let s=parseInt((c==null?void 0:c.value)||"1",10),r=parseInt((d==null?void 0:d.value)||"5",10);if(t==="count"){const n=parseInt((e==null?void 0:e.value)||"1",10);!isNaN(n)&&n>0&&(r=s+n-1,d&&(d.value=r.toString()))}if((isNaN(s)||s<1)&&(s=1),(isNaN(r)||r<1)&&(r=1),t!=="count"&&e&&document.activeElement!==e){const n=Math.max(0,r-s+1);e.value=n>0?n.toString():""}a&&(a.textContent=`(V${s}–V${r})`)}function h(t){var p;const o=((p=document.getElementById("dup-initial-message"))==null?void 0:p.value)||"",i=document.getElementById("chk-custom-video-ids"),a=document.getElementById("input-custom-video-ids");if(i!=null&&i.checked&&a){const u=I(a.value);if(u.length===0){alert("Validation Error: Please specify at least one valid Video ID (e.g. V3, V4, V7, V9, V10).");return}chrome.runtime.sendMessage({type:"DUPLICATE_CHATS",count:u.length,initialText:o,explicitVideoIds:u},()=>f());return}const c=document.getElementById("dup-range-start"),d=document.getElementById("dup-range-end");let e=parseInt((c==null?void 0:c.value)||"1",10),s=parseInt((d==null?void 0:d.value)||"5",10);if((isNaN(e)||e<1)&&(e=1),(isNaN(s)||s<1)&&(s=1),e>s){alert(`Validation Error: Start Video ID (V${e}) cannot be greater than End Video ID (V${s}).`);return}const n=s-e+1;chrome.runtime.sendMessage({type:"DUPLICATE_CHATS",count:n,initialText:o,startVideoId:e,endVideoId:s},()=>f())}function f(){chrome.runtime.sendMessage({type:"GET_STATE"},t=>{t&&t.state&&(t.state,T(t.state),N(t.state),S(t.state.logs))})}function N(t){const o=document.getElementById("popup-videos-container"),i=document.getElementById("popup-progress-badge");if(!o)return;const a=t.tabs.filter(e=>e.parts.length>0||e.status==="running"),c=a.length>0?a:t.tabs.slice(0,3);if(c.length===0){o.innerHTML='<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 12px;">No active videos yet. Click Duplicate or open chats to begin.</div>',i&&(i.textContent="Idle");return}const d=t.tabs.filter(e=>e.status==="running").length;i&&(i.textContent=d>0?`${d} Running ⚡`:"Synchronized ✓",i.style.color=d>0?"#f59e0b":"#34d399",i.style.background=d>0?"rgba(245, 158, 11, 0.15)":"rgba(16, 185, 129, 0.15)"),o.innerHTML=c.map(e=>{const s=e.index||parseInt(e.id.replace(/\D/g,""),10)||1,r=e.totalParts>0?e.totalParts:e.parts.length>0?e.parts.length:1,n=!!(e.scriptStatus&&e.scriptStatus!=="none"||e.scriptId);let p="";n?p='<span style="color: #38bdf8; font-size: 10px; font-weight: 600; margin-left: 6px;" title="Reference script uploaded: direct parts mode">[REF SCRIPT ✓]</span>':e.outlineDetected&&(p='<span style="color: #10b981; font-size: 10px; font-weight: 600; margin-left: 6px;">[OUTLINE: ✓]</span>');const u=e.missingParts&&e.missingParts.length>0?`
      <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 10px; margin-bottom: 6px;">
        ⚠️ MISSING: ${e.missingParts.map(l=>`${e.id} P${l}`).join(", ")}
      </div>
    `:"",g=e.duplicateParts&&e.duplicateParts.length>0?`
      <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); color: #fcd34d; padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 10px; margin-bottom: 6px;">
        ⚠️ DUPLICATE: ${e.duplicateParts.map(l=>`${e.id} P${l}`).join(", ")}
      </div>
    `:"";let y="";n||(e.outlineStatus==="generating"||!e.outlineDetected&&e.status==="running"?y=`
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
            <div style="display: flex; align-items: center; gap: 6px; color: #f59e0b; font-weight: bold;">
              <span style="color: #f59e0b;">*</span>
              <strong>OUTLINE</strong>
              <span style="color: #f59e0b; font-weight: bold;">⚡</span>
            </div>
            <span style="font-size: 10px; color: #f59e0b; font-weight: 600;">
              OUTLINE GENERATING...
            </span>
          </div>
        `:(e.outlineDetected||e.outlineStatus==="completed")&&(y=`
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
            <div style="display: flex; align-items: center; gap: 6px; color: #10b981; font-weight: bold;">
              <span style="color: #10b981;">*</span>
              <strong>OUTLINE</strong>
              <span style="color: #10b981; font-weight: bold;">✓</span>
            </div>
            <span style="font-size: 10px; color: #10b981; font-weight: 600;">
              OUTLINE GENERATED ✓
            </span>
          </div>
        `));const b=e.parts.map(l=>{const B=l.explicitMarker||`${e.id} P${l.partNumber}`;let v='<span style="color: #64748b;">○</span>',E="#94a3b8",x="Queue";l.status==="done"?(v='<span style="color: #10b981; font-weight: bold;">✓</span>',E="#10b981",x="Generated ✓"):l.status==="generating"?(v='<span style="color: #f59e0b; font-weight: bold;">⚡</span>',E="#f59e0b",x="Generating..."):l.status==="ready"||l.status==="waiting"?(v='<span style="color: #64748b;">○</span>',E="#94a3b8",x="Queue"):l.status==="error"&&(v='<span style="color: #ef4444; font-weight: bold;">✕</span>',E="#ef4444",x="Error");const $=l.heading?`<span style="color: #94a3b8; font-size: 11px; margin-left: 4px;">— ${l.heading}</span>`:"",w=l.hasDoubleResponse?`<span style="background: rgba(59, 130, 246, 0.2); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 3px; padding: 0 4px; font-size: 9px; margin-left: 4px;" title="Double response detected (${l.candidateCount||2} variants).">[2 variants]</span>`:"";return`
        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
          <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 380px;">
            <span style="color: #94a3b8;">*</span>
            <strong>${B}</strong>
            ${v}
            ${$}
            ${w}
          </div>
          <span style="font-size: 10px; color: ${E}; font-weight: 600; letter-spacing: 0.2px;">
            ${x}
          </span>
        </div>
      `}).join("");return`
      <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding-bottom: 4px;">
          <div>
            <strong style="color: #60a5fa; font-size: 12px; text-transform: uppercase;">VIDEO ${s}</strong>
            ${p}
          </div>
          <span style="font-size: 11px; color: #cbd5e1;">Total Parts: <strong>${r}</strong></span>
        </div>
        ${u}
        ${g}
        <div style="display: flex; flex-direction: column; gap: 2px;">
          ${y}
          ${b||(y?"":'<div style="color: #64748b; font-size: 11px;">* No explicit parts detected yet —</div>')}
        </div>
      </div>
    `}).join("")}function T(t){const o=t.tabs.length,i=t.tabs.filter(n=>n.status==="ready").length,a=t.tabs.filter(n=>n.status==="running").length,c=t.tabs.filter(n=>n.status==="completed").length,d=document.getElementById("stat-total"),e=document.getElementById("stat-ready"),s=document.getElementById("stat-running"),r=document.getElementById("stat-completed");d&&(d.textContent=String(o)),e&&(e.textContent=String(i)),s&&(s.textContent=String(a)),r&&(r.textContent=String(c))}function S(t){const o=document.getElementById("activity-log-container");if(!o)return;const i=t.slice(0,8);o.innerHTML=i.map(a=>`
    <div class="log-line">
      <span class="log-time">[${a.timeStr}]</span>
      <span class="log-level-${a.level}">[${a.level}]</span>
      <span class="log-msg">${a.message}</span>
    </div>
  `).join("")}document.addEventListener("DOMContentLoaded",L);
