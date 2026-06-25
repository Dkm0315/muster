import"./modulepreload-polyfill-B5Qt9EMX.js";/* empty css               */import{i as T}from"./theme-DEORF_6t.js";const C={generatedAt:"2026-06-11T12:40:53.442Z",generator:"scripts/generate-portal-data.mjs"},O=[{prompt:"Summarize what changed on uat-erp since Friday and flag anything blocking the release.",runId:"ea59ad5f-d0bd-4b7c-be00-4f490bc8dea0",runtime:"native",model:"stub/stub-model",taskKind:"simple_qa",status:"completed",tokensLine:"in=54~ out=64~",recalledMemories:1,response:"Since Friday, 23 changes landed on uat-erp. Two are release-blocking: the pending payroll patch (migration 0412_payroll not applied) and a failing permission test on Leave Application (perm_scope_user). Everything else is documentation and fixture updates.",rawOutput:`recalled 1 scoped memories into context
run=ea59ad5f-d0bd-4b7c-be00-4f490bc8dea0 runtime=native model=stub/stub-model task=simple_qa status=completed
tokens in=54~ out=64~

Since Friday, 23 changes landed on uat-erp. Two are release-blocking: the pending payroll patch (migration 0412_payroll not applied) and a failing permission test on Leave Application (perm_scope_user). Everything else is documentation and fixture updates.`},{prompt:"Where do we deploy?",runId:"1c4be09b-1a91-4d01-8e1f-8c12b300cf45",runtime:"native",model:"stub/stub-model",taskKind:"simple_qa",status:"completed",tokensLine:"in=37~ out=64~",recalledMemories:1,response:"Since Friday, 23 changes landed on uat-erp. Two are release-blocking: the pending payroll patch (migration 0412_payroll not applied) and a failing permission test on Leave Application (perm_scope_user). Everything else is documentation and fixture updates.",rawOutput:`recalled 1 scoped memories into context
run=1c4be09b-1a91-4d01-8e1f-8c12b300cf45 runtime=native model=stub/stub-model task=simple_qa status=completed
tokens in=37~ out=64~

Since Friday, 23 changes landed on uat-erp. Two are release-blocking: the pending payroll patch (migration 0412_payroll not applied) and a failing permission test on Leave Application (perm_scope_user). Everything else is documentation and fixture updates.`},{prompt:"What does our token spend look like so far?",runId:"f93507c8-8dc8-49d1-8e83-939747c364cf",runtime:"native",model:"stub/stub-model",taskKind:"simple_qa",status:"completed",tokensLine:"in=11~ out=43~",recalledMemories:0,response:"Across the recorded runs in this workspace the ledger shows estimated input/output tokens per run; no replay-waste flags so far. Run `muster tokens` for the per-run table.",rawOutput:`run=f93507c8-8dc8-49d1-8e83-939747c364cf runtime=native model=stub/stub-model task=simple_qa status=completed
tokens in=11~ out=43~

Across the recorded runs in this workspace the ledger shows estimated input/output tokens per run; no replay-waste flags so far. Run \`muster tokens\` for the per-run table.`}],S={definition:{id:"deploy-digest",description:"Summarize deploy changes, gate on human approval, then post.",steps:[{id:"fetch",kind:"tool",tool:"echo",args:{summary:"23 changes since Friday; 2 release blockers"}},{id:"approve",kind:"gate",show:"fetch.summary",expiresHours:48},{id:"post",kind:"tool",tool:"echo",args:{body:"{{fetch.summary}}"},when:"approve.granted"}]},runId:"flowrun_89e4607c",saveOutput:`flow=deploy-digest steps=3
saved=/private/var/folders/k2/n64mwl1j6bvdt7d9cc3z__hw0000gn/T/muster-portal-7xxdPI/.muster/flows/deploy-digest.json
next: muster flow check deploy-digest`,checkOutput:"flow=deploy-digest preflight=ok",runOutput:`run=flowrun_89e4607c flow=deploy-digest
step=fetch status=started
step=fetch status=completed
step=approve status=gate_pending expires=2026-06-13T12:40:52.573Z
flow_run=flowrun_89e4607c status=awaiting_approval gate=approve
--- gate shows ---
23 changes since Friday; 2 release blockers
------------------
approve: muster flow approve flowrun_89e4607c
reject:  muster flow reject flowrun_89e4607c`,approveOutput:`step=approve status=approved
step=post status=started
step=post status=completed
run_status=completed
flow_run=flowrun_89e4607c status=completed`,showOutput:`flow_run=flowrun_89e4607c flow=deploy-digest status=completed tokens=-
file=/private/var/folders/k2/n64mwl1j6bvdt7d9cc3z__hw0000gn/T/muster-portal-7xxdPI/.muster/data/flows/flowrun_89e4607c.jsonl
definition=/private/var/folders/k2/n64mwl1j6bvdt7d9cc3z__hw0000gn/T/muster-portal-7xxdPI/.muster/flows/deploy-digest.json
run=flowrun_89e4607c flow=deploy-digest
step=fetch status=started
step=fetch status=completed
step=approve status=gate_pending expires=2026-06-13T12:40:52.573Z
step=approve status=approved
step=post status=started
step=post status=completed
run_status=completed`},I=`run            model                        in       out      est  cost$    waste   session   
----------------------------------------------------------------------------------------------
ea59ad5f-d0bd- stub/stub-model              54       64       ~    -        -       -         
1c4be09b-1a91- stub/stub-model              37       64       ~    -        -       -         
f93507c8-8dc8- stub/stub-model              11       43       ~    -        -       -         

totals by model              runs   in         out        cost$      waste-runs
--------------------------------------------------------------------------------
stub/stub-model              3      102        171        -          0`,L=`integrity check at 2026-06-11T12:40:53.159Z: OK

store      lines    corrupt
---------- -------- --------
episodes   3        0       
feedback   0        0       
memory     4        0       
tokens     3        0`,E=`muster status — 2026-06-11T12:40:53.297Z
----------------------------------------------------------------
profile              default
providers            2 configured (local, stub)
default runtime      native
episodes             3 recorded (last: f93507c8-8dc8-49d1-8e83-939747c364cf 2026-06-11T12:40:52.095Z)
tokens today         273 across 3 runs
schedules            0 total, 0 due now
flows pending gate   none
verify               OK`,A=`ea59ad5f-d0bd-4b7c-be00-4f490bc8dea0 2026-06-11T12:40:51.473Z simple_qa native/stub/stub-model Summarize what changed on uat-erp since Friday and flag anything blocking the re
1c4be09b-1a91-4d01-8e1f-8c12b300cf45 2026-06-11T12:40:51.777Z simple_qa native/stub/stub-model Where do we deploy?
f93507c8-8dc8-49d1-8e83-939747c364cf 2026-06-11T12:40:52.095Z simple_qa native/stub/stub-model What does our token spend look like so far?`,j={sessions:3,flows:1,surfaces:["telegram","slack","discord","whatsapp","gchat","teams","web"]},o={meta:C,runs:O,flow:S,tokens:I,verify:L,status:E,episodes:A,counts:j};T();const c=e=>{const n=document.getElementById(e);if(!n)throw new Error(`missing #${e}`);return n};function t(e,n,s){const r=document.createElement(e);return n&&(r.className=n),s!==void 0&&(r.textContent=s),r}function f(e,n="dim"){return t("span",`chip ${n}-chip`,e)}function m(e,n,s={}){const r=t("details","block tool-block");s.open&&(r.open=!0);const a=t("summary");a.append(t("span","tool-name mono",e));for(const i of s.chips??[])a.append(i);const d=t("pre","mono");return d.textContent=n,r.append(a,d),r}function p(e,n,s=""){const r=t("div",`artifact ${s}`.trim());r.append(t("p","artifact-title mono",e));const a=t("pre","mono");return a.textContent=n,r.append(a),r}const v=new Map(o.status.split(`
`).map(e=>e.match(/^(\S[\w ]*?)\s{2,}(.+)$/)).filter(e=>e!==null).map(e=>[e[1]??"",e[2]??""]));c("portal-profile").textContent=`profile: ${v.get("profile")??"default"}`;c("real-meta").textContent=`captured ${o.meta.generatedAt.slice(0,16).replace("T"," ")} UTC · ${o.meta.generator} · deterministic stub LLM`;c("count-sessions").textContent=String(o.counts.sessions);c("count-flows").textContent=String(o.counts.flows);c("count-surfaces").textContent=String(o.counts.surfaces.length);c("verify-flag").textContent=o.verify.includes(": OK")?"OK":"CHECK";c("rail-tokens").textContent=v.get("tokens today")??"—";function q(e,n,s){const r=t("section","run-group reveal");r.style.setProperty("--reveal-delay",`${n*70}ms`);const a=t("div","runlog-head"),d=t("h2");d.append(t("span","mono",`run_${e.runId.slice(0,8)}`),f(e.status,e.status==="completed"?"ok":"warn")),a.append(d),a.append(t("p","mono dim",`runtime=${e.runtime} · model=${e.model} · task=${e.taskKind}`)),r.append(a);const i=t("article","block user-block"),u=t("header");if(u.append(t("span","who","prompt")),i.append(u,t("p",void 0,e.prompt)),r.append(i),e.recalledMemories>0){const y=t("article","block sys-block"),b=t("header");b.append(t("span","who","harness"),f("memory","dim"));const g=t("p","mono");g.append(`recalled ${e.recalledMemories} scoped ${e.recalledMemories===1?"memory":"memories"} → `),g.append(t("span","scope","user:dhairya")),y.append(b,g),r.append(y)}const l=t("article","block agent-block"),k=t("header");return k.append(t("span","who who-agent","agent"),f(`tokens ${e.tokensLine}`,"dur")),l.append(k,t("p",void 0,e.response)),r.append(l),r.append(m(`$ muster run "${e.prompt.slice(0,48)}${e.prompt.length>48?"…":""}" — raw output`,e.rawOutput)),r.addEventListener("click",()=>s(e)),r}function F(e,n){const s=t("div","runlog-head reveal");s.append(t("h1",void 0,"Sessions")),s.append(t("p","mono dim",`${o.counts.sessions} episodes recorded in this workspace — output below is verbatim from \`muster run\``)),e.append(s);const r=a=>{n.replaceChildren(t("p","theater-head","run details"),p("episode",[`episode=${a.runId}`,`runtime=${a.runtime}`,`model=${a.model}`,`task_kind=${a.taskKind}`,`status=${a.status}`,`memories_recalled=${a.recalledMemories}`].join(`
`)),p("run ledger",`tokens ${a.tokensLine}
model  ${a.model}`,"artifact-ledger"),p("muster verify",o.verify))};o.runs.forEach((a,d)=>e.append(q(a,d,r))),n.replaceChildren(t("p","theater-head","workspace"),p("muster status",o.status),p("muster episodes",o.episodes))}function K(e,n){const s=t("div","runlog-head reveal");s.append(t("h1",void 0,"Flows")),s.append(t("p","mono dim",`flow=${o.flow.definition.id} · ${o.flow.definition.steps.length} steps · run=${o.flow.runId} — full save → check → run → gate → approve lifecycle, captured live`)),e.append(s),[["definition: deploy-digest.json",JSON.stringify(o.flow.definition,null,2),!1],["$ muster flow save deploy-digest.json",o.flow.saveOutput,!1],["$ muster flow check deploy-digest",o.flow.checkOutput,!1],["$ muster flow run deploy-digest — halts at the approval gate",o.flow.runOutput,!0],[`$ muster flow approve ${o.flow.runId}`,o.flow.approveOutput,!0],[`$ muster flow show ${o.flow.runId}`,o.flow.showOutput,!1]].forEach(([a,d,i],u)=>{const l=m(a,d,{open:i,chips:i?[f("gate","warn")]:[]});l.classList.add("reveal"),l.style.setProperty("--reveal-delay",`${u*70}ms`),e.append(l)}),n.replaceChildren(t("p","theater-head","gate evidence"),p("approver saw",`23 changes since Friday; 2 release blockers

(the gate shows the ACTUAL step output,
not a step name)`),p("durable run record",`flow_run=${o.flow.runId}
status=completed
store=.muster/data/flows/${o.flow.runId}.jsonl
(gate state lives in the run record —
survives gateway restarts)`))}function M(e,n){const s=t("div","runlog-head reveal");s.append(t("h1",void 0,"Surfaces")),s.append(t("p","mono dim","one gateway, one message envelope — six webhook adapters in packages/gateway/src/adapters plus the web client in packages/surface")),e.append(s);const r={telegram:"webhook adapter · packages/gateway/src/adapters/telegram.ts",slack:"webhook adapter · packages/gateway/src/adapters/slack.ts",discord:"ed25519-verified interactions · packages/gateway/src/adapters/discord.ts",whatsapp:"webhook adapter · packages/gateway/src/adapters/whatsapp.ts",gchat:"webhook adapter · packages/gateway/src/adapters/gchat.ts",teams:"webhook adapter · packages/gateway/src/adapters/teams.ts",web:"browser client · packages/surface (POST /v1/messages)"},a=t("div","surface-grid");o.counts.surfaces.forEach((d,i)=>{const u=t("div","block surface-card reveal");u.style.setProperty("--reveal-delay",`${i*60}ms`);const l=t("header");l.append(t("span","who",d),f("paired via muster pairing","dim")),u.append(l,t("p","mono dim",r[d]??"adapter")),a.append(u)}),e.append(a),e.append(m("start the gateway",`muster gateway init
muster gateway start --port 7460
muster pairing list | approve <code>`,{open:!0})),n.replaceChildren(t("p","theater-head","envelope"),p("one envelope, any frontend",JSON.stringify({surfaceId:"web:demo",conversationId:"demo",senderId:"demo-user",text:"say something…"},null,2)),p("pairing",`first message from an unknown sender
returns status=pairing_required + code;
operator runs:
  muster pairing approve <code>`))}function Z(e,n){const s=t("div","runlog-head reveal");s.append(t("h1",void 0,"Tokens")),s.append(t("p","mono dim","every run lands on the ledger — this table is the verbatim output of `muster tokens` for the captured workspace")),e.append(s),e.append(m("$ muster tokens",o.tokens,{open:!0})),e.append(m("$ muster status",o.status)),n.replaceChildren(t("p","theater-head","ledger"),p("today",`${v.get("tokens today")??"—"}
waste flags: 0`,"artifact-ledger"),p("muster verify",o.verify))}function P(e,n){const s=t("div","runlog-head reveal");s.append(t("h1",void 0,"Verify")),s.append(t("p","mono dim","append-only stores are integrity-checked — verbatim output of `muster verify`")),e.append(s),e.append(m("$ muster verify",o.verify,{open:!0,chips:[f("OK","ok")]})),e.append(m("$ muster episodes",o.episodes,{open:!0})),n.replaceChildren(t("p","theater-head","stores"),p("checked stores",`episodes · feedback · memory · tokens
(JSONL, line-level corruption detection)`))}const z={sessions:F,flows:K,surfaces:M,tokens:Z,verify:P},h=c("runlog"),$=c("theater"),_=Array.from(document.querySelectorAll(".rail-item[data-view]"));function x(e){const n=z[e];if(n){for(const s of _)s.classList.toggle("active",s.dataset.view===e);h.replaceChildren(),$.replaceChildren(),n(h,$),h.scrollTop=0}}for(const e of _)e.addEventListener("click",()=>x(e.dataset.view??"sessions"));x("sessions");const w=document.getElementById("muster-view-toggle"),H=document.getElementById("muster-view");w?.addEventListener("click",()=>{const e=H?.classList.toggle("collapsed")??!1;w.setAttribute("aria-expanded",String(!e)),w.textContent=e?"muster view ▸":"muster view ▾"});if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)for(const e of document.querySelectorAll("animateMotion"))e.remove();
