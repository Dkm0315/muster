import"./modulepreload-polyfill-B5Qt9EMX.js";const g=[{id:"purpose",eyebrow:"01 / shape",title:"What should your assistant be able to do?",body:"Pick one, pick five, pick all of it. Muster will build a profile around what you actually want instead of dumping commands at you.",mode:"multi",choices:[{id:"code",label:"Build with code",detail:"Repo search, tests, code review, fixes, release notes, Codex and Claude Code routing.",badge:"developer",color:"lavender",followUps:["Repo-aware defaults","Fast shell tasks","PR and release workflows"]},{id:"apps",label:"Connect work apps",detail:"Google Drive, chat surfaces, GitHub, browser, web search, and MCP tools.",badge:"integrations",color:"cyan",followUps:["OAuth setup guides","Scoped app memory","Tool permissions"]},{id:"frappe",label:"Set up Frappe / ERPNext",detail:"Site URL, installed apps, DocTypes, fields, workflows, reports, and module docs.",badge:"bench-aware",color:"peach",followUps:["DocType graph","Module context","Tenant-safe retrieval"]},{id:"memory",label:"Personal memory",detail:"Preferences, project facts, named sessions, and scoped recall with receipts.",badge:"recall",color:"lime",followUps:["Less repeated context","Memory receipts","Ask-before-save mode"]},{id:"research",label:"Research the web",detail:"Fresh sources, browser checks, Playwright paths, and artifact-ready summaries.",badge:"source-grounded",color:"cyan",followUps:["Web search","Browser QA","Artifact handoff"]},{id:"team",label:"Team workflows",detail:"Agents, subagents, scheduled checks, dashboards, channel surfaces, and MCPs.",badge:"operations",color:"lavender",followUps:["Subagent routing","Dashboard status","Channel adapters"]}]},{id:"style",eyebrow:"02 / priorities",title:"What should Muster optimize for?",body:"These choices tune the assistant's behavior. The interesting part is that the product can market the guarantee while configuring it.",mode:"multi",choices:[{id:"speed",label:"Fast answers",detail:"Prefer direct tools and short context when the task is simple.",badge:"low latency",color:"cyan"},{id:"accuracy",label:"Accuracy",detail:"Use receipts, sources, and eval gates before trusting generated context.",badge:"evidence",color:"lavender"},{id:"tokens",label:"Use fewer tokens",detail:"Retrieve targeted memory instead of stuffing old transcripts into every prompt.",badge:"less waste",color:"lime"},{id:"privacy",label:"Prevent leaks",detail:"Keep tenant, workspace, user, role, and session scopes explicit.",badge:"scope rails",color:"peach"},{id:"local",label:"Local-first when possible",detail:"Prefer local routes for sensitive work and escalate only when needed.",badge:"quiet mode",color:"lavender"},{id:"explain",label:"Explain retrieval",detail:"Show why memory was recalled and what was ignored.",badge:"receipts",color:"cyan"}]},{id:"provider",eyebrow:"03 / model",title:"Which model routes should Muster prepare?",body:"Pick one or many. Muster can keep a fast daily route, a deeper fallback, and a private self-hosted route without asking people to memorize model names.",mode:"multi",choices:[{id:"codex",label:"Codex",detail:"Best default for coding, repo work, terminal tasks, and fast operational loops.",badge:"recommended",color:"cyan"},{id:"claude",label:"Claude Code",detail:"Familiar coding assistant flow with strong planning and editing behavior.",badge:"coding",color:"lavender"},{id:"openai",label:"OpenAI API",detail:"Direct cloud models with configurable presets and token accounting.",badge:"cloud",color:"cyan"},{id:"anthropic",label:"Anthropic API",detail:"Claude models through API keys and governed runtime routes.",badge:"cloud",color:"peach"},{id:"selfhosted",label:"Self-hosted endpoint",detail:"Private OpenAI-compatible routes for teams that already run a reliable model gateway.",badge:"private",color:"lime"},{id:"hybrid",label:"Hybrid",detail:"Fast default model with stronger fallback, recorded as evidence.",badge:"balanced",color:"lavender"}]},{id:"integrations",eyebrow:"04 / senses",title:"Choose your assistant's senses.",body:"Every selected app gets a guided setup path. Credentials are not persisted by the onboarding prototype.",mode:"multi",choices:[{id:"frappe",label:"Frappe / ERPNext",detail:"Site URL, app list, modules, DocTypes, fields, workflows, reports, scripts.",badge:"plugin",color:"peach"},{id:"drive",label:"Google Drive",detail:"Docs, Sheets, Slides context with file-aware retrieval.",badge:"oauth",color:"cyan"},{id:"github",label:"GitHub",detail:"Repos, issues, pull requests, release notes, and CI context.",badge:"dev",color:"lavender"},{id:"browser",label:"Browser + Playwright",detail:"Inspect web apps, test flows, capture visual evidence.",badge:"qa",color:"lime"},{id:"web",label:"Web search",detail:"Fresh source-grounded answers without pretending stale docs are current.",badge:"fresh",color:"cyan"},{id:"mcp",label:"MCP bridge",detail:"Bring external tools into Muster with policy and setup guidance.",badge:"tools",color:"peach"},{id:"artifacts",label:"Artifact Studio",detail:"Reports, dashboards, generated docs, and shareable outputs.",badge:"output",color:"lime"}]},{id:"channels",eyebrow:"05 / channels",title:"Where should your assistant talk?",body:"Pick each channel separately. Every surface has a different auth model, so Muster should open the right credential window instead of hiding them inside one bundled card.",mode:"multi",choices:[{id:"google-chat",label:"Google Chat",detail:"Workspace bot endpoint, signing secret, and app authentication.",badge:"workspace",color:"cyan"},{id:"slack",label:"Slack",detail:"Bot token, signing secret, app-level token, and channel install.",badge:"bot",color:"lavender"},{id:"teams",label:"Microsoft Teams",detail:"Bot app ID, tenant ID, client secret, and Teams app package.",badge:"enterprise",color:"peach"},{id:"whatsapp",label:"WhatsApp",detail:"Business phone ID, access token, verify token, and webhook secret.",badge:"business",color:"lime"},{id:"discord",label:"Discord",detail:"Bot token, application ID, public key, and guild/channel defaults.",badge:"community",color:"lavender"},{id:"telegram",label:"Telegram",detail:"Bot token and webhook URL where Telegram is available.",badge:"regional",color:"cyan"}]},{id:"memory",eyebrow:"06 / memory contract",title:"How should Muster remember?",body:"Memory is not a transcript dump. It is scoped, searchable, receipt-backed context that should lower token waste and reduce repeated explanation.",mode:"multi",choices:[{id:"chat",label:"Remember this chat",detail:"Keep short-term continuity for the current session.",badge:"session",color:"cyan"},{id:"project",label:"Remember project context",detail:"Persist repo, app, and deployment facts in workspace/tenant scopes.",badge:"project",color:"lavender"},{id:"preferences",label:"Remember my preferences",detail:"Tone, workflow, provider, and answer preferences.",badge:"personal",color:"peach"},{id:"site",label:"Remember app/site context",detail:"Index Frappe or web-app context with graph links and receipts.",badge:"plugin context",color:"lime"},{id:"ask",label:"Ask before saving",detail:"Show what will be remembered before writing durable memory.",badge:"consent",color:"cyan"},{id:"never",label:"Never save automatically",detail:"Use the assistant without durable memory writes.",badge:"private",color:"lavender"}]},{id:"finish",eyebrow:"ready",title:"Your assistant is taking shape.",body:"",mode:"finish",choices:[]}],E=new Map([["memory","Future-you just got a helper."],["frappe","Bench-aware mode unlocked."],["tokens","Token discipline enabled. No ceremony when a small answer will do."],["privacy","Boundaries matter. Scope rails are on."],["local","Quiet mode. Nice."]]),w=document.querySelector("#onboarding-root");if(!w)throw new Error("Missing onboarding root.");const v=w;let i=0,r=0,h="intro";const n=new Map;for(const e of g)n.set(e.id,new Set);function f(){const e=g[i];if(!e)throw new Error(`Invalid onboarding step index: ${i}`);return e}function k(e){return n.get(f().id)?.has(e.id)??!1}function $(e){const t=f(),a=n.get(t.id);a&&(t.mode==="single"?(a.clear(),a.add(e.id)):a.has(e.id)?a.delete(e.id):a.add(e.id),m("select-pop"))}function y(e){const t=f();t.mode!=="finish"&&(r=(r+e+t.choices.length)%t.choices.length,m(e>0?"rail-down":"rail-up"))}function A(){i<g.length-1&&(i+=1,r=0,h="slide-forward",m(h))}function S(){i>0&&(i-=1,r=0,h="slide-back",m(h))}function P(){return g.flatMap(e=>e.choices.filter(t=>n.get(e.id)?.has(t.id)).map(t=>t.label))}function m(e="intro"){const t=f(),a=P(),o=t.choices[r],l=U();v.innerHTML=`
    <div class="aurora-field" aria-hidden="true">
      <span class="orb orb-one"></span>
      <span class="orb orb-two"></span>
      <span class="orb orb-three"></span>
    </div>
    <section class="desktop-frame ${e}">
      <header class="desktop-topbar">
        <div class="traffic"><i></i><i></i><i></i></div>
        <div class="window-title">muster onboarding prototype</div>
        <a href="/" class="site-link">website palette</a>
      </header>
      <div class="terminal-stage">
        <aside class="journey-panel">
          <div class="brand-lockup">
            <span class="brand-mark">M</span>
            <div>
              <p>Muster</p>
              <span>personal assistant setup</span>
            </div>
          </div>
          <div class="progress-list">
            ${g.slice(0,-1).map((s,p)=>`
              <div class="progress-item ${p===i?"active":""} ${p<i?"done":""}">
                <span>${String(p+1).padStart(2,"0")}</span>
                <p>${s.id==="style"?"priorities":s.id}</p>
              </div>
            `).join("")}
          </div>
          <div class="token-card">
            <span>why this matters</span>
            <strong>Less context stuffing. More targeted recall.</strong>
            <p>Scoped SQLite retrieval and memory receipts help lower token waste while reducing cross-tenant leaks.</p>
          </div>
        </aside>

        <section class="terminal-card">
          <div class="animated-rail"></div>
          ${t.mode==="finish"?R(a,l):C(t,o,l)}
        </section>

        <aside class="detail-panel">
          ${N(t,o)}
        </aside>
      </div>
    </section>
  `,v.querySelectorAll("[data-choice]").forEach((s,p)=>{s.addEventListener("click",()=>{const d=t.choices[p];d&&(r=p,$(d))})}),v.querySelector("[data-next]")?.addEventListener("click",A),v.querySelector("[data-back]")?.addEventListener("click",S),v.querySelector("[data-restart]")?.addEventListener("click",()=>{for(const s of n.values())s.clear();i=0,r=0,m("slide-back")})}function C(e,t,a){const o=e.choices.filter(l=>n.get(e.id)?.has(l.id));return`
    <div class="terminal-header">
      <span>${e.eyebrow}</span>
      <div class="chip-tray">${P().slice(0,5).map(l=>`<b>${l}</b>`).join("")}</div>
    </div>
    <div class="copy-block">
      <h1>${i===0?"Welcome to Muster.":e.title}</h1>
      ${i===0?"<h2>Let's build the assistant that remembers your work, protects your context, and spends fewer tokens getting useful answers.</h2>":""}
      <p>${e.body}</p>
    </div>
    <div class="choice-grid ${e.id==="integrations"||e.id==="channels"?"dense":""}">
      ${e.choices.map((l,s)=>`
        <button class="choice-card ${l.color} ${s===r?"focused":""} ${k(l)?"selected":""}" data-choice="${l.id}" type="button">
          <span class="choice-state">${k(l)?"✓":e.mode==="single"?"○":"◇"}</span>
          <span class="choice-main">
            <strong>${l.label}</strong>
            <small>${l.detail}</small>
          </span>
          <em>${l.badge??""}</em>
        </button>
      `).join("")}
    </div>
    <div class="proof-strip">
      ${a.map(l=>`<span>${l}</span>`).join("")}
    </div>
    ${I(e,o)}
    <footer class="terminal-actions">
      <button type="button" data-back ${i===0?"disabled":""}>Esc back</button>
      <p>Space select · Enter continue · Tab details · ↑↓ move</p>
      <button type="button" data-next>Continue</button>
    </footer>
    ${t?`<div class="toast">${E.get(t.id)??"Selection staged. Muster will turn this into setup, not homework."}</div>`:""}
  `}function I(e,t){if(!t.length)return`
      <section class="setup-drawer idle">
        <div>
          <span>next surface</span>
          <strong>Select one or more options to open guided setup.</strong>
        </div>
        <p>No commands. No guessing. The real onboarding should ask for only the fields needed by the things selected here.</p>
      </section>
    `;const a=t.map(o=>O(e,o)).join("");return`
    <section class="setup-drawer">
      <header>
        <div>
          <span>guided setup</span>
          <strong>${t.length} selected ${t.length===1?"path":"paths"}</strong>
        </div>
        <p>Prototype fields are local-only. Real Muster should save only after explicit confirmation.</p>
      </header>
      <div class="setup-panels">${a}</div>
    </section>
  `}function O(e,t){return e.id==="purpose"?`
      <article class="setup-panel ${t.color}">
        <h4>${t.label}</h4>
        <p>${t.detail}</p>
        <div class="setup-options">
          ${(t.followUps??[]).map(a=>`<label><input type="checkbox" checked /> ${a}</label>`).join("")}
        </div>
        ${u(e,t)}
      </article>
    `:e.id==="style"?`
      <article class="setup-panel ${t.color}">
        <h4>${t.label}</h4>
        <p>${t.detail}</p>
        <div class="setup-meter">
          <span>relaxed</span><input type="range" min="1" max="5" value="${t.id==="speed"?"5":"4"}" /><span>strict</span>
        </div>
        ${u(e,t)}
      </article>
    `:e.id==="provider"?`
      <article class="setup-panel ${t.color}">
        <h4>${t.label}</h4>
        <p>${t.detail}</p>
        <div class="field-grid">
          <label>Mode<select><option>Fast daily work</option><option>Balanced</option><option>Deep reasoning</option><option>Cheapest reliable</option><option>Ask each time</option></select></label>
          <label>Model preset<select>${x(t.id).map(a=>`<option>${a}</option>`).join("")}</select></label>
          ${t.id==="selfhosted"?'<label>Endpoint<input placeholder="https://models.internal.example/v1" /></label>':`<label>API key env<input placeholder="${T(t.id)}" /></label>`}
        </div>
        ${u(e,t)}
      </article>
    `:e.id==="integrations"?`
      <article class="setup-panel ${t.color}">
        <h4>${t.label}</h4>
        <p>${t.detail}</p>
        ${_(t.id)}
        ${u(e,t)}
      </article>
    `:e.id==="channels"?`
      <article class="setup-panel ${t.color}">
        <h4>${t.label}</h4>
        <p>${t.detail}</p>
        ${D(t.id)}
        ${u(e,t)}
      </article>
    `:e.id==="memory"?`
      <article class="setup-panel ${t.color}">
        <h4>${t.label}</h4>
        <p>${t.detail}</p>
        <div class="setup-options">
          <label><input type="checkbox" checked /> Show memory receipt after recall</label>
          <label><input type="checkbox" ${t.id==="never"?"":"checked"} /> Ask before durable write</label>
          <label><input type="checkbox" checked /> Keep tenant/user/session scopes visible</label>
        </div>
        ${u(e,t)}
      </article>
    `:""}function u(e,t){const a=c(e,t);return e.id==="purpose"?`
      <div class="control-deck">
        <label>Autonomy<select><option>Ask before major actions</option><option>Act on safe tasks</option><option>Autopilot after approval</option></select></label>
        <label>Output style<select><option>Concise</option><option>Step-by-step</option><option>Executive summary</option></select></label>
        <p><strong>Impact</strong>${a}</p>
      </div>
    `:e.id==="style"?`
      <div class="control-deck">
        <label>Priority weight<input type="range" min="1" max="5" value="${t.id==="speed"?"5":"4"}" /></label>
        <label>When conflicting<select><option>Ask me</option><option>Favor this priority</option><option>Balance automatically</option></select></label>
        <p><strong>Impact</strong>${a}</p>
      </div>
    `:e.id==="provider"?`
      <div class="control-deck">
        <label>Use for<select><option>Default route</option><option>Fallback only</option><option>Deep work only</option><option>Ask each run</option></select></label>
        <label>Budget guard<select><option>Balanced cost</option><option>Lowest cost</option><option>Best quality</option><option>Local if sensitive</option></select></label>
        <p><strong>Impact</strong>${a}</p>
      </div>
    `:e.id==="integrations"?`
      <div class="control-deck">
        <label>Permission<select><option>Read-only first</option><option>Ask before write</option><option>Trusted workspace writes</option></select></label>
        <label>Context depth<select><option>Light index</option><option>Balanced index</option><option>Deep graph index</option></select></label>
        <p><strong>Impact</strong>${a}</p>
      </div>
    `:e.id==="channels"?`
      <div class="control-deck">
        <label>Reply mode<select><option>Draft first</option><option>Auto-reply low risk</option><option>Manual only</option></select></label>
        <label>Visibility<select><option>Only mentioned threads</option><option>Selected channels</option><option>Workspace-wide digest</option></select></label>
        <p><strong>Impact</strong>${a}</p>
      </div>
    `:e.id==="memory"?`
      <div class="control-deck">
        <label>Recall strictness<input type="range" min="1" max="5" value="${t.id==="never"?"5":"4"}" /></label>
        <label>Retention<select><option>This project</option><option>30 days</option><option>Until I remove it</option><option>Never durable</option></select></label>
        <p><strong>Impact</strong>${a}</p>
      </div>
    `:""}function c(e,t){return e.id==="purpose"&&t.id==="code"?"Muster will bias toward repo-aware tools, tests, and direct shell actions before long model reasoning.":e.id==="purpose"&&t.id==="frappe"?"Muster will prepare app/module/DocType context so Frappe questions retrieve field evidence instead of generic ERP guesses.":e.id==="purpose"&&t.id==="memory"?"Muster will ask what is worth remembering and use scoped recall to reduce repeated explanations.":e.id==="style"&&t.id==="speed"?"Short tasks prefer tools and compact prompts, which lowers latency but may ask before deep analysis.":e.id==="style"&&t.id==="tokens"?"Retrieval runs before prompt stuffing, so fewer old tokens are sent and receipts explain what was recalled.":e.id==="style"&&t.id==="privacy"?"Tenant, user, workspace, role, and session scopes stay visible so memory does not bleed across contexts.":e.id==="provider"?"This affects which model handles fast turns, deep turns, and fallbacks; route changes are recorded instead of hidden.":e.id==="integrations"&&t.id==="frappe"?"Deep graph indexing improves module/field accuracy but takes more setup than a light docs-only index.":e.id==="integrations"?"Read-only setup is safer; deeper indexing gives richer answers but requires more permissions.":e.id==="channels"?"Draft-first keeps humans in control; auto-reply is faster but should be limited to low-risk channels.":e.id==="memory"&&t.id==="never"?"Maximum privacy, but Muster will not personalize future sessions unless you re-provide context.":e.id==="memory"?"Higher recall strictness reduces weird stale hits; broader retention improves personalization over time.":"This changes the default assistant behavior and will appear in the generated profile before anything is saved."}function x(e){return e==="codex"?["gpt-5.5 fast","gpt-5.5 balanced","gpt-5.5 deep"]:e==="claude"?["Claude Code default","Claude Sonnet","Claude Opus"]:e==="openai"?["GPT-5.5","GPT-5.5 mini","GPT-4.1"]:e==="anthropic"?["Claude Sonnet","Claude Haiku","Claude Opus"]:e==="selfhosted"?["served-model","private fast route","private deep route"]:["Fast primary + deep fallback","Cloud + private fallback","Ask per task"]}function T(e){return e==="anthropic"||e==="claude"?"ANTHROPIC_API_KEY":e==="openai"||e==="codex"||e==="hybrid"?"OPENAI_API_KEY":"API_KEY_ENV"}function _(e){return e==="frappe"?`
      <div class="field-grid">
        <label>Site URL<input placeholder="https://erp.example.com" /></label>
        <label>Auth mode<select><option>API token</option><option>One-time admin login</option></select></label>
        <label>API token / env<input placeholder="FRAPPE_API_TOKEN" /></label>
        <label>Module focus<input placeholder="Accounts, HR, Stock, custom app" /></label>
      </div>
      <a class="setup-link" href="#">Open /app/user to create token</a>
    `:e==="drive"||e==="github"?`
      <div class="field-grid">
        <label>Connection<select><option>Open OAuth in browser</option><option>Paste token/env var</option><option>Configure later</option></select></label>
        <label>Scope<select><option>Workspace only</option><option>User + workspace</option><option>Ask every time</option></select></label>
      </div>
      <a class="setup-link" href="#">Open secure sign-in flow</a>
    `:e==="browser"||e==="web"?`
      <div class="setup-options">
        <label><input type="checkbox" checked /> Enable source receipts</label>
        <label><input type="checkbox" checked /> Keep browser actions approval-gated</label>
        <label><input type="checkbox" /> Capture screenshots during QA</label>
      </div>
    `:`
    <div class="field-grid">
      <label>Setup mode<select><option>Use built-in pack</option><option>Connect MCP server</option><option>Configure later</option></select></label>
      <label>Permission level<select><option>Read-only first</option><option>Ask before write</option><option>Trusted workspace</option></select></label>
    </div>
  `}function D(e){return e==="slack"?`
      <div class="field-grid">
        <label>Bot token/env<input placeholder="SLACK_BOT_TOKEN" /></label>
        <label>Signing secret/env<input placeholder="SLACK_SIGNING_SECRET" /></label>
        <label>App token/env<input placeholder="SLACK_APP_TOKEN" /></label>
        <label>Default channel<input placeholder="#team-ai" /></label>
      </div>
      <a class="setup-link" href="#">Open Slack app configuration</a>
    `:e==="teams"?`
      <div class="field-grid">
        <label>Bot app ID<input placeholder="TEAMS_BOT_APP_ID" /></label>
        <label>Tenant ID<input placeholder="AZURE_TENANT_ID" /></label>
        <label>Client secret/env<input placeholder="TEAMS_CLIENT_SECRET" /></label>
        <label>Install scope<select><option>Team</option><option>Organization</option><option>Personal</option></select></label>
      </div>
      <a class="setup-link" href="#">Open Azure Bot registration</a>
    `:e==="whatsapp"?`
      <div class="field-grid">
        <label>Phone number ID<input placeholder="WHATSAPP_PHONE_NUMBER_ID" /></label>
        <label>Access token/env<input placeholder="WHATSAPP_ACCESS_TOKEN" /></label>
        <label>Verify token/env<input placeholder="WHATSAPP_VERIFY_TOKEN" /></label>
        <label>Webhook secret/env<input placeholder="WHATSAPP_WEBHOOK_SECRET" /></label>
      </div>
      <a class="setup-link" href="#">Open Meta WhatsApp setup</a>
    `:e==="telegram"?`
      <div class="field-grid">
        <label>Bot token/env<input placeholder="TELEGRAM_BOT_TOKEN" /></label>
        <label>Webhook URL<input placeholder="https://example.com/webhook/telegram" /></label>
      </div>
      <a class="setup-link" href="#">Open BotFather setup</a>
    `:e==="google-chat"?`
      <div class="field-grid">
        <label>Project ID<input placeholder="GOOGLE_CLOUD_PROJECT" /></label>
        <label>Signing secret/env<input placeholder="GOOGLE_CHAT_SIGNING_SECRET" /></label>
        <label>Service account<input placeholder="GOOGLE_APPLICATION_CREDENTIALS" /></label>
        <label>Space default<input placeholder="spaces/..." /></label>
      </div>
      <a class="setup-link" href="#">Open Google Chat API setup</a>
    `:`
    <div class="field-grid">
      <label>Bot token/env<input placeholder="DISCORD_BOT_TOKEN" /></label>
      <label>Application ID<input placeholder="DISCORD_APPLICATION_ID" /></label>
      <label>Public key<input placeholder="DISCORD_PUBLIC_KEY" /></label>
      <label>Default guild/channel<input placeholder="guild/channel id" /></label>
    </div>
    <a class="setup-link" href="#">Open Discord developer portal</a>
  `}function R(e,t){const a=b("purpose").join(" + ")||"Personal assistant",o=b("provider")[0]??"Codex",l=b("integrations"),s=b("channels"),p=b("memory").join(", ")||"Scoped session memory";return`
    <div class="terminal-header">
      <span>profile generated</span>
      <div class="chip-tray">${e.slice(0,6).map(d=>`<b>${d}</b>`).join("")}</div>
    </div>
    <div class="finish-hero">
      <span class="success-ring">✓</span>
      <h1>Your assistant is ready to become useful.</h1>
      <p>It knows what to remember, what to protect, what to connect, and when to avoid wasting tokens.</p>
    </div>
    <div class="profile-grid">
      <article><span>Purpose</span><strong>${a}</strong></article>
      <article><span>Provider</span><strong>${o}</strong></article>
      <article><span>Memory</span><strong>${p}</strong></article>
      <article><span>Integrations</span><strong>${l.length?l.join(", "):"Configure later"}</strong></article>
      <article><span>Channels</span><strong>${s.length?s.join(", "):"Configure later"}</strong></article>
    </div>
    <div class="impact-summary">
      ${M().map(d=>`<span>${d}</span>`).join("")}
    </div>
    <div class="proof-strip final">
      ${t.map(d=>`<span>${d}</span>`).join("")}
    </div>
    <div class="launch-grid">
      <button type="button">Start chatting</button>
      <button type="button">Configure selected apps</button>
      <button type="button">Run health check</button>
      <button type="button">Open dashboard</button>
    </div>
    <footer class="terminal-actions">
      <button type="button" data-back>Back</button>
      <p>Easter egg: press restart when product asks for one more first impression.</p>
      <button type="button" data-restart>Restart ride</button>
    </footer>
  `}function M(){const e=["Muster will show setup before saving anything."];return n.get("style")?.has("tokens")&&e.push("Low-token retrieval will run before old context is added."),n.get("style")?.has("privacy")&&e.push("Tenant/user/workspace/session scopes stay visible."),n.get("integrations")?.has("frappe")&&e.push("Frappe answers will prefer module, DocType, field, and workflow context."),n.get("channels")?.size&&e.push("Channel replies default to controlled setup, not blind auto-send."),n.get("memory")?.has("ask")&&e.push("Durable memory writes require confirmation."),e.slice(0,5)}function N(e,t){const a=b(e.id),o=e.choices.filter(l=>n.get(e.id)?.has(l.id));return e.id==="finish"?`
      <p class="panel-kicker">handoff</p>
      <h3>No commands dumped.</h3>
      <p>The real implementation should write config/profile state, then open guided setup links only when an external provider needs auth.</p>
      <div class="link-card">Frappe setup opens <strong>/app/user</strong></div>
      <div class="link-card">OAuth setup opens provider auth links</div>
      <div class="link-card">MCP setup shows safe install choices</div>
    `:`
    <p class="panel-kicker">live preview</p>
    <h3>${t?.label??"Move through options"}</h3>
    <p>${t?.detail??"The detail panel changes with the highlighted option."}</p>
    ${o.length?`
      <div class="side-setup">
        <p class="panel-kicker">selected setup</p>
        ${o.slice(0,2).map(l=>L(e,l)).join("")}
        ${o.length>2?`<small>+${o.length-2} more selected paths in the main setup drawer</small>`:""}
      </div>
    `:`
      <div class="side-setup empty">
        <p class="panel-kicker">selected setup</p>
        <strong>Pick options to open fields, links, and setup modes here.</strong>
      </div>
    `}
    <div class="mini-terminal">
      <span>$ muster onboarding</span>
      <span class="dim">transition: ${G()}</span>
      <span class="ok">selected: ${a.length||0}</span>
      <span class="dim">step: ${e.id}</span>
    </div>
    <div class="follow-list">
      ${(t?.followUps??["Guided setup","Profile write","Health check"]).map(l=>`<span>${l}</span>`).join("")}
    </div>
    <div class="transition-stack">
      <p class="panel-kicker">transition stack</p>
      <span>Aurora rail sweep</span>
      <span>Panel slide forward/back</span>
      <span>Selection bloom</span>
      <span>Chip tray carry-over</span>
      <span>Success ring pulse</span>
    </div>
    <div class="feature-callout">
      <strong>Marketing woven into setup</strong>
      <p>Every choice reinforces token savings, scoped memory, leak prevention, or app-aware assistance.</p>
    </div>
  `}function L(e,t){return e.id==="provider"?`
      <article class="side-setup-card">
        <strong>${t.label}</strong>
        <label>Mode<select><option>Fast daily work</option><option>Balanced</option><option>Deep reasoning</option></select></label>
        <label>Key/env<input placeholder="${t.id==="selfhosted"?"https://models.internal.example/v1":T(t.id)}" /></label>
        <p class="impact-mini">${c(e,t)}</p>
      </article>
    `:e.id==="integrations"&&t.id==="frappe"?`
      <article class="side-setup-card">
        <strong>Frappe / ERPNext</strong>
        <label>Site URL<input placeholder="https://erp.example.com" /></label>
        <label>Auth mode<select><option>API token</option><option>One-time admin login</option><option>Configure later</option></select></label>
        <label>Token/env<input placeholder="FRAPPE_API_TOKEN" /></label>
        <label>Module focus<input placeholder="Accounts, HR, Stock, custom app" /></label>
        <a href="#">Open /app/user</a>
        <p class="impact-mini">${c(e,t)}</p>
      </article>
    `:e.id==="channels"?`
      <article class="side-setup-card">
        <strong>${t.label}</strong>
        ${B(t.id)}
        <p class="impact-mini">${c(e,t)}</p>
      </article>
    `:e.id==="integrations"?`
      <article class="side-setup-card">
        <strong>${t.label}</strong>
        <label>Setup<select><option>Open guided auth</option><option>Use env var</option><option>Configure later</option></select></label>
        <label>Scope<select><option>Workspace only</option><option>User + workspace</option></select></label>
        <p class="impact-mini">${c(e,t)}</p>
      </article>
    `:e.id==="memory"?`
      <article class="side-setup-card">
        <strong>${t.label}</strong>
        <label><input type="checkbox" checked /> Show receipts</label>
        <label><input type="checkbox" checked /> Ask before durable write</label>
        <p class="impact-mini">${c(e,t)}</p>
      </article>
    `:`
    <article class="side-setup-card">
      <strong>${t.label}</strong>
      <label><input type="checkbox" checked /> Enable this path</label>
      <label><input type="checkbox" checked /> Add to profile summary</label>
      <p class="impact-mini">${c(e,t)}</p>
    </article>
  `}function B(e){return e==="slack"?'<label>Bot token/env<input placeholder="SLACK_BOT_TOKEN" /></label><label>Signing secret<input placeholder="SLACK_SIGNING_SECRET" /></label><a href="#">Open Slack setup</a>':e==="teams"?'<label>App ID<input placeholder="TEAMS_BOT_APP_ID" /></label><label>Tenant<input placeholder="AZURE_TENANT_ID" /></label><a href="#">Open Azure setup</a>':e==="whatsapp"?'<label>Phone ID<input placeholder="WHATSAPP_PHONE_NUMBER_ID" /></label><label>Token/env<input placeholder="WHATSAPP_ACCESS_TOKEN" /></label><a href="#">Open Meta setup</a>':e==="telegram"?'<label>Bot token/env<input placeholder="TELEGRAM_BOT_TOKEN" /></label><label>Webhook URL<input placeholder="https://.../telegram" /></label><a href="#">Open BotFather</a>':e==="google-chat"?'<label>Project ID<input placeholder="GOOGLE_CLOUD_PROJECT" /></label><label>Signing secret<input placeholder="GOOGLE_CHAT_SIGNING_SECRET" /></label><a href="#">Open Google Chat setup</a>':'<label>Bot token/env<input placeholder="DISCORD_BOT_TOKEN" /></label><label>Application ID<input placeholder="DISCORD_APPLICATION_ID" /></label><a href="#">Open Discord setup</a>'}function b(e){const t=g.find(o=>o.id===e),a=n.get(e)??new Set;return t?.choices.filter(o=>a.has(o.id)).map(o=>o.label)??[]}function U(){const e=["Scoped memory","Token ledger","Leak-resistant"];return n.get("style")?.has("tokens")&&e.push("Low-token mode"),n.get("style")?.has("privacy")&&e.push("Tenant rails"),n.get("memory")?.size&&e.push("Receipts"),n.get("integrations")?.has("frappe")&&e.push("Frappe graph context"),n.get("channels")?.size&&e.push("Channel auth"),e.slice(0,6)}function G(){return h==="slide-forward"?"panel slide + aurora sweep":h==="slide-back"?"reverse slide":"selection bloom"}document.addEventListener("keydown",e=>{if(e.key==="ArrowDown")e.preventDefault(),y(1);else if(e.key==="ArrowUp")e.preventDefault(),y(-1);else if(e.key===" "&&f().mode!=="finish"){e.preventDefault();const t=f().choices[r];t&&$(t)}else e.key==="Enter"?(e.preventDefault(),A()):e.key==="Escape"&&(e.preventDefault(),S())});m();
