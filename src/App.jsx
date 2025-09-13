import React, { useMemo, useState, useEffect, useCallback } from "react";
import { motion as Motion } from "framer-motion";
import { Check, Play, Loader2, X } from "lucide-react";

// --- Minimal UI primitives ---
const Card = ({ children, className = "" }) => (
  <div className={`rounded-2xl shadow-sm border p-4 bg-white ${className}`}>{children}</div>
);
const Button = ({ children, className = "", ...props }) => (
  <button className={`px-3 py-2 rounded-2xl border shadow-sm text-sm hover:shadow transition ${className}`} {...props}>
    {children}
  </button>
);
const TextArea = (props) => (
  <textarea {...props} className={`w-full rounded-xl border p-2 text-sm min-h-[90px] ${props.className||''}`} />
);
const Section = ({ title, subtitle, children }) => (
  <Card className="space-y-2">
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{title}</div>
      {subtitle && <div className="text-sm text-gray-600">{subtitle}</div>}
    </div>
    {children}
  </Card>
);

// ----------------------
// Provider-agnostic helpers
// ----------------------
function parseSSEorJSONLine(line){
  let s = (line||"").trim();
  if(!s) return null;
  if(s.startsWith("data:")) s = s.slice(5).trim();
  if(s === "[DONE]") return null;
  try{
    const obj = JSON.parse(s);
    if(typeof obj === 'string') return obj;
    if(obj?.text) return String(obj.text);
    if(obj?.delta) return String(obj.delta);
    if(obj?.message?.content) return String(obj.message.content);
    if(obj?.response) return String(obj.response); // Ollama /api/generate
    return null;
  }catch{
    return s; // plain token
  }
}

// --- Vercel AI + Ollama server snippets (copy/paste)
function ServerSnippets(){
  const NEXT_OPENAI = `import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
export const runtime = 'edge';
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
export async function POST(req) {
  const { messages, system, model = 'gpt-4o-mini' } = await req.json();
  const result = await streamText({ model: openai(model), system, messages });
  return result.toAIStreamResponse();
}`;

  const NEXT_OLLAMA = `// Node runtime required to reach localhost:11434
export const runtime = 'nodejs';
export async function POST(req) {
  const { messages, system, model = 'llama3' } = await req.json();
  const resp = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true, messages: [ { role: 'system', content: system }, ...messages ] })
  });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller){
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while(true){
        const { value, done } = await reader.read();
        if(done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/); buf = lines.pop() || '';
        for(const line of lines){
          if(!line.trim()) continue;
          try{
            const j = JSON.parse(line);
            const tok = j?.message?.content || j?.response || '';
            if(tok){ controller.enqueue(encoder.encode('data: '+JSON.stringify({ text: tok })+'\n\n')); }
            if(j?.done){ controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); return; }
          }catch{ /* ignore */ }
        }
      }
    }
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}`;

  const EXPRESS_PROXY = `import express from 'express';
const app = express(); app.use(express.json());
app.post('/api/chat', async (req, res) => {
  const { provider = 'openai', model, messages, system } = req.body || {};
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if(provider === 'ollama'){
    const r = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || 'llama3', stream: true, messages: [ { role: 'system', content: system }, ...messages ] })
    });
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of r.body){
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split(/\r?\n/); buf = lines.pop() || '';
      for(const line of lines){
        if(!line.trim()) continue;
        try{ const j = JSON.parse(line); const tok = j?.message?.content || j?.response; if(tok) res.write('data: '+JSON.stringify({ text: tok })+'\n\n'); if(j?.done){ res.write('data: [DONE]\n\n'); res.end(); return; } }catch{}
      }
    }
    return;
  }
  // default: echo a stub token
  res.write('data: '+JSON.stringify({ text: 'stub: wire OpenAI/Anthropic here' })+'\n\n');
  res.write('data: [DONE]\n\n'); res.end();
});
app.listen(3001);`;

  return (
    <div className="space-y-3 text-xs">
      <div className="text-sm font-semibold">Next.js OpenAI route (Vercel AI SDK)</div>
      <pre className="bg-gray-900 text-gray-100 p-3 rounded-xl overflow-auto">{NEXT_OPENAI}</pre>
      <div className="text-sm font-semibold">Next.js Ollama route (local http://127.0.0.1:11434)</div>
      <pre className="bg-gray-900 text-gray-100 p-3 rounded-xl overflow-auto">{NEXT_OLLAMA}</pre>
      <div className="text-sm font-semibold">Express provider proxy (OpenAI/Ollama)</div>
      <pre className="bg-gray-900 text-gray-100 p-3 rounded-xl overflow-auto">{EXPRESS_PROXY}</pre>
      <div>
        Client posts <code>{'{ messages, system, provider, model }'}</code>. Server streams <code>{'data: {"text":"..."}'}</code> lines and ends with <code>data: [DONE]</code>.
      </div>
    </div>
  );
}

// --- Chat preview (provider-agnostic)
function ChatPreview({ system, provider, model }) {
  const [messages, setMessages] = useState([{ role: 'assistant', content: 'Chat ready. Type a message.' }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const ctrlRef = React.useRef(null);

  async function send(textOverride, historyOverride) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    if(!historyOverride) setInput('');
    const base = historyOverride || messages;
    const next = [...base, { role: 'user', content: text }, { role: 'assistant', content: '' }];
    setMessages(next);
    setBusy(true);
    const idx = next.length - 1;

    try {
      const ctrl = new AbortController(); ctrlRef.current = ctrl;
      const body = provider === 'ollama'
        ? { model, stream: true, messages: next.filter((_, i) => i !== idx) }
        : { messages: next.filter((_, i) => i !== idx), system, provider, model };
      const url = provider === 'ollama' ? 'http://127.0.0.1:11434/api/chat' : '/api/chat';
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      if (!res.ok || !res.body) throw new Error('bad response');
      const reader = res.body.getReader(); const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/); buf = lines.pop() || '';
        for (const chunk of lines) {
          const tok = parseSSEorJSONLine(chunk);
          if(tok == null) continue;
          next[idx].content += String(tok);
          setMessages([...next]);
        }
      }
    } catch (e) {
      const n = [...messages, { role: 'assistant', content: `Error: ${String(e)}` }];
      setMessages(n);
    } finally { setBusy(false); }
  }

  function regenerate(){
    if(busy) return;
    let uIdx = -1;
    for(let i = messages.length - 1; i >= 0; i--){ if(messages[i].role === 'user'){ uIdx = i; break; } }
    if(uIdx === -1) return;
    const history = messages.slice(0, uIdx);
    const text = messages[uIdx].content;
    send(text, history);
  }

  function stop() { if (ctrlRef.current) ctrlRef.current.abort(); }
  function clear() { setMessages([{ role: 'assistant', content: 'Chat reset.' }]); }

  return (
    <div className="space-y-2">
      <div className="max-h-64 overflow-auto rounded-xl border p-3 text-sm bg-white">
        {messages.map((m, i) => (
          <div key={i} className="mb-2"><span className="font-semibold">{m.role === 'user' ? 'You' : 'Assistant'}:</span> {m.content}</div>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="flex-1 rounded-xl border p-2 text-sm" placeholder="Message" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') send(); }} />
        <Button onClick={()=>send()} className="bg-black text-white">Send</Button>
        <Button onClick={regenerate}>Regen</Button>
        <Button onClick={stop}>Stop</Button>
        <Button onClick={clear}>Clear</Button>
      </div>
      <div className="text-xs text-gray-500">
        POST <code>{provider === 'ollama' ? 'http://127.0.0.1:11434/api/chat' : '/api/chat'}</code> with <code>{'{ messages, system, provider, model }'}</code>.
        Streams lines either as SSE <code>data: {`{"text":"..."}`}</code> or raw JSON; both supported.
      </div>
    </div>
  );
}

// --- Inference helpers ---
const ROLE_RULES = [
  { re: /\b(frontend|react|ui|ux)\b/i, role: "Frontend Engineer", stages: ["UI/UX","Frontend"], scope: "Deliver accessible, performant UI against design and API contracts." },
  { re: /\b(backend|api|service|microservice|rest|grpc|graphql)\b/i, role: "Backend Engineer", stages: ["Backend","Tooling"], scope: "Design stable APIs and services with reliability and observability." },
  { re: /\b(mobile|ios|android|swift|kotlin)\b/i, role: "Mobile Engineer", stages: ["UI/UX","Frontend"], scope: "Ship native app features with offline and telemetry." },
  { re: /\b(data|warehouse|etl|analytics|lakehouse)\b/i, role: "Data Engineer", stages: ["Data/DB","Backend"], scope: "Build pipelines, schemas, and quality checks." },
  { re: /\b(ml|model|training|inference)\b/i, role: "ML Engineer", stages: ["Data/DB","Backend"], scope: "Train and serve models with reproducibility." },
  { re: /\b(devops|platform|infra|kubernetes|k8s|terraform|sre)\b/i, role: "DevOps/SRE", stages: ["Infra/Cloud","Build/CI","Observability"], scope: "Provide reliable deploys, infra as code, and SLOs." },
  { re: /\b(qa|test|automation)\b/i, role: "QA Automation Engineer", stages: ["QA/Test","Maintenance"], scope: "Automate regression and reliability gates." }
];

function inferRoleFromInputs(needs, techStack){
  const hay = `${needs} ${techStack}`;
  for(const r of ROLE_RULES){ if(r.re.test(hay)) return r; }
  return { role: "Backend Engineer", stages: ["Backend","Tooling"], scope: "Design stable APIs and services with reliability and observability." };
}

function inferTechFromStack(role, techStack){
  if(techStack && techStack.trim()) return techStack.trim();
  const r = (role||"").toLowerCase();
  if(/\brust\b/.test(techStack||r)) return "Rust, Cargo, tokio, sqlx, Postgres, Docker";
  if(/\b(go|golang)\b/.test(techStack||r)) return "Go, chi, Postgres, Docker";
  if(/\b(node|node\.js|typescript|javascript|ts|js)\b/.test(techStack||r)) return "TypeScript, Node.js, Fastify, Prisma, Postgres, Docker";
  if(/\bpython\b/.test(techStack||r)) return "Python 3.11, FastAPI, Pydantic, SQLAlchemy, Postgres, Docker";
  if(/\b(react|frontend|ui)\b/.test(techStack||r)) return "React, TypeScript, Vite, ESLint/Prettier, Playwright";
  if(/\b(devops|infra|kubernetes|k8s|sre|terraform)\b/.test(techStack||r)) return "Terraform, Kubernetes, Helm, Prometheus/Grafana, GitHub Actions";
  return "TypeScript, Node.js, Docker, GitHub Actions";
}

// Fallback inference from existing fields
function inferRole(task, context) {
  const txt = (task + " " + context).toLowerCase();
  if (/\b(api|backend|service|rest|grpc|graphql)\b/.test(txt)) return "Backend Engineer — lifecycle: Backend";
  if (/\b(ui|ux|frontend|react)\b/.test(txt)) return "Frontend Engineer — lifecycle: Frontend";
  if (/\b(infra|terraform|kubernetes|k8s)\b/.test(txt)) return "DevOps Engineer — lifecycle: Infra/Cloud";
  if (/\b(data|schema|etl|warehouse|lakehouse)\b/.test(txt)) return "Data Engineer — lifecycle: Data/DB";
  return "Full-Stack Engineer — lifecycle: Backend + Frontend";
}
function inferTech(role, techStack) {
  if (techStack && techStack.trim()) return techStack;
  const r = role.toLowerCase();
  if (r.includes("backend")) return "Node.js, Express, Postgres, Docker";
  if (r.includes("frontend")) return "React, TypeScript, Vite, ESLint";
  if (r.includes("devops")) return "Terraform, Kubernetes, GitHub Actions";
  if (r.includes("data")) return "Python, SQL, Airflow, dbt";
  return "TypeScript, Node.js, Docker";
}

export default function App() {
  // Optional user inputs for inference
  const [needs, setNeeds] = useState("");
  const [techStack, setTechStack] = useState("");

  // Provider + model
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('gpt-4o-mini');
  const [ollamaModels, setOllamaModels] = useState([]);

  const refreshOllamaModels = useCallback(async () => {
    try{
      const res = await fetch('http://127.0.0.1:11434/api/tags');
      if(!res.ok) return;
      const data = await res.json();
      const names = data?.models?.map(m=>m.name) || [];
      setOllamaModels(names);
      if(names.length && !names.includes(model)) setModel(names[0]);
    }catch { /* empty */ }
  }, [model]);

  useEffect(() => {
    if(provider === 'ollama') refreshOllamaModels();
  }, [provider, refreshOllamaModels]);

  // Six-section state
  const [role, setRole] = useState("");
  const [task, setTask] = useState("- [3–7 high-leverage steps tailored to the role]");
  const [context, setContext] = useState(`**Standards & policies:** [list]\n**Tech stack & environment:** [list]\n**Constraints & NFRs:** [bullets with targets]\n**Interfaces & dependencies:** [list]\n**Data & compliance:** [rules]\n**Assumptions:** [inferred]\n**Out of scope:** [exclusions]`);
  const [reasoning, setReasoning] = useState("- [criterion 1]\n- [criterion 2]\n- [criterion 3]\n- [criterion 4]");
  const [outputSpec, setOutputSpec] = useState(`- [Artifact type] — [purpose]\n\n\`\`\`[language or format]\n[content]\n\`\`\`\n\n*Usage/validation:* [commands or CI job names]`);
  const [stop, setStop] = useState("- [primary completion criterion]\n- [secondary]\n- [tertiary]");

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [testResults, setTestResults] = useState([]);

  const inferredRole = useMemo(() => (role && !role.includes("[")) ? role : inferRole(task, context), [role, task, context]);
  const inferredTech = useMemo(() => inferTech(inferredRole, techStack), [inferredRole, techStack]);

  const finalContext = useMemo(() => {
    const replaced = context.includes("**Tech stack & environment:** [list]")
      ? context.replace("**Tech stack & environment:** [list]", `**Tech stack & environment:** ${inferredTech}`)
      : context;
    const assumptions = [
      role ? "- Role provided by user" : `- Role inferred as ${inferredRole}`,
      techStack ? `- Tech stack provided: ${techStack}` : `- Tech stack inferred: ${inferredTech}`
    ].join("\n");
    return `${replaced}\n**Assumptions:**\n${assumptions}`;
  }, [context, inferredTech, inferredRole, role, techStack]);

  const promptText = useMemo(() => {
    return [
      `**Universal 6-Section Dev Prompt Builder (Hiro v2)**`,
      `You are Hiro, a master-level coding optimization specialist. Your job is to generate a complete, production-oriented prompt—structured into six sections—that another specialist model can execute.`,
      `---`,
      `1) Role\n${inferredRole}`,
      `2) Task\n${task}`,
      `3) Context\n${finalContext}`,
      `4) Reasoning\n${reasoning}`,
      `5) Output format\n${outputSpec}`,
      `6) Stop conditions\n${stop}`
    ].join("\n\n");
  }, [inferredRole, task, finalContext, reasoning, outputSpec, stop]);

  async function run(){ setRunning(true); try{ setResult({ prompt: promptText, valid: true }); } finally { setRunning(false); } }

  function inferFromInputs(){
    const info = inferRoleFromInputs(needs, techStack);
    const tech = inferTechFromStack(info.role, techStack);
    const roleLine = `${info.role} — lifecycle: ${info.stages.join(', ')}. Scope: ${info.scope} Primary tech/tooling: ${tech}.`;
    setRole(roleLine);
    const steps = [
      "Analyze requirements and constraints",
      "Apply relevant standards and patterns",
      info.role.includes("Frontend") ? "Produce component specs and stories" :
      info.role.includes("DevOps") ? "Provision infra and CI with policy checks" :
      info.role.includes("Data") ? "Define schemas and pipelines with quality checks" :
      "Define API/contracts and handler skeletons",
      "Add quickstart and validation"
    ];
    setTask(steps.map(s => `- ${s}`).join('\n'));
    const assumptions = [
      needs ? `Inferred role from needs: ${info.role}` : `Defaulted role: ${info.role}`,
      techStack ? `Tech stack provided: ${techStack}` : `Tech stack inferred: ${tech}`
    ].map(a => `- ${a}`).join('\n');
    const ctx = [
      `**Standards & policies:** OWASP ASVS L2; Twelve-Factor; SemVer; SPDX`,
      `**Tech stack & environment:** ${tech}`,
      `**Constraints & NFRs:** latency p95 ≤ 200ms; uptime ≥ 99.9%; cost ceiling sensible`,
      `**Interfaces & dependencies:** HTTP/JSON; Postgres; queue optional`,
      `**Data & compliance:** minimize PII; 30–90d retention`,
      `**Assumptions:**\n${assumptions}`,
      `**Out of scope:** prolonged discovery; unrelated UIs`
    ].join('\n');
    setContext(ctx);
    if(info.role.includes('Frontend')){
      setOutputSpec(`- Component spec — states and props\n\n\`\`\`md\n| State | Inputs | Expected |\n|---|---|---|\n| default | none | renders |\n\n\`\`\`\n\n*Usage/validation:* run storybook and a11y checks`);
    } else if(info.role.includes('DevOps')){
      setOutputSpec(`- Terraform module — provision core infra\n\n\`\`\`hcl\nterraform { required_providers { aws = { source = "hashicorp/aws" } } }\n\n\`\`\`\n\n*Usage/validation:* terraform plan && policy checks`);
    } else {
      setOutputSpec(`- OpenAPI — API contract\n\n\`\`\`yaml\nopenapi: 3.1.0\ninfo: { title: sample, version: 0.1.0 }\n\n\`\`\`\n\n*Usage/validation:* run contract tests in CI`);
    }
    setStop(["- One compilable artifact + quickstart","- Contract/tests pass locally and in CI"].join('\n'));
  }

  async function suggestOptionals(){
    const prompt = 'Suggest a short "needs" statement and tech stack. Return JSON {"needs":"...","techStack":"..."}.';
    try{
      const url = provider === 'ollama' ? 'http://127.0.0.1:11434/api/chat' : '/api/chat';
      const body = provider === 'ollama'
        ? { model, stream: true, messages: [ { role: 'user', content: prompt } ] }
        : { provider, model, stream: true, messages: [ { role: 'user', content: prompt } ] };
      const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if(!res.body) return;
      const reader = res.body.getReader(); const dec = new TextDecoder();
      let buf='', out='';
      while(true){
        const {value, done} = await reader.read(); if(done) break;
        buf += dec.decode(value,{stream:true});
        const lines = buf.split(/\r?\n/); buf = lines.pop() || '';
        for(const line of lines){ const tok = parseSSEorJSONLine(line); if(tok!=null) out += String(tok); }
      }
      const j = JSON.parse(out);
      if(j.needs) setNeeds(j.needs);
      if(j.techStack) setTechStack(j.techStack);
    }catch { /* empty */ }
  }

  // --- Inline self-tests ---
  function runInlineTests(){
    const results = [];
    const t = (name, fn) => { try { fn(); results.push({ name, pass: true }); } catch (e) { results.push({ name, pass: false, msg: String(e) }); } };
    t("join with newline produces two lines", () => { const out = ["a","b"].map(s=>`- ${s}`).join('\n'); if(out !== "- a\n- b") throw new Error(out); });
    t("SSE split handles CRLF and LF", () => { const s = "data: one\r\ndata: two\n\n"; const lines = s.split(/\r?\n/); if(lines.length < 3) throw new Error(String(lines.length)); });
    t("parse supports SSE and JSON lines", () => {
      const a = parseSSEorJSONLine('data: {"text":"hi"}');
      const b = parseSSEorJSONLine('{"message":{"content":"hi"},"done":false}');
      if(a !== 'hi' || b !== 'hi') throw new Error(String(a)+","+String(b));
    });
    t("Button returns a React element", () => { const el = Button({ children: 'ok' }); if(!el || el.type !== 'button') throw new Error(JSON.stringify(el)); });
    t("prompt contains 6 section headings", () => {
      const p = [ `1) Role`, `2) Task`, `3) Context`, `4) Reasoning`, `5) Output format`, `6) Stop conditions` ];
      const full = [ `1) Role\nX`, `2) Task\nX`, `3) Context\nX`, `4) Reasoning\nX`, `5) Output format\nX`, `6) Stop conditions\nX` ].join('\n\n');
      for(const k of p){ if(!full.includes(k)) throw new Error(k); }
    });
    t("help snippet keeps braces as string", () => { const snippet = '{ messages, system }'; if (typeof snippet !== 'string' || !snippet.includes('{') || !snippet.includes('}')) throw new Error(snippet); });
    t("SSE data snippet is string literal", () => { const s = 'data: {"text":"..."}'; if(typeof s !== 'string' || !s.includes('{"text"')) throw new Error(s); });
    t("inferRoleFromInputs detects backend for REST api", () => { const r = inferRoleFromInputs("build a REST api", ""); if(r.role.indexOf("Backend") === -1) throw new Error(JSON.stringify(r)); });
    t("inferRoleFromInputs detects frontend for React UI", () => { const r = inferRoleFromInputs("build a React UI", ""); if(r.role.indexOf("Frontend") === -1) throw new Error(JSON.stringify(r)); });
    t("inferRoleFromInputs detects DevOps for k8s/terraform", () => { const r = inferRoleFromInputs("deploy on k8s with terraform", ""); if(r.role.indexOf("DevOps") === -1 && r.role.indexOf("SRE") === -1) throw new Error(JSON.stringify(r)); });
    t("inferRoleFromInputs detects Data for ETL", () => { const r = inferRoleFromInputs("daily ETL for warehouse", ""); if(r.role.indexOf("Data") === -1) throw new Error(JSON.stringify(r)); });
    t("inferTechFromStack respects provided stack", () => { const tech = inferTechFromStack("Backend Engineer", "Go, chi, Postgres"); if(tech.indexOf("Go") === -1) throw new Error(tech); });
    t("word-boundary prevents 'ui' match inside 'build'", () => { const r = inferRoleFromInputs("we will build services", ""); if(r.role.indexOf("Frontend") !== -1) throw new Error(JSON.stringify(r)); });
    t("fallback inferRole from fields works", () => { const r = inferRole("- define api", "**Tech**"); if(r.indexOf("Backend") === -1) throw new Error(r); });
    return results;
  }

  useEffect(() => { setTestResults(runInlineTests()); }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <Motion.h1 initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} className="text-2xl font-bold">Universal 6-Section Dev Prompt Builder (Hiro v2) — with inference</Motion.h1>

        <Section title="Provider & model">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <select className="rounded-xl border p-2 text-sm" value={provider} onChange={e=>{ const p = e.target.value; setProvider(p); setModel(p==='ollama' ? (ollamaModels[0]||'llama3') : 'gpt-4o-mini'); }}>
              <option value="openai">openai</option>
              <option value="ollama">ollama (local)</option>
            </select>
            {provider === 'ollama' ? (
              <div className="flex gap-2">
                <select className="rounded-xl border p-2 text-sm flex-1" value={model} onChange={e=>setModel(e.target.value)}>
                  {ollamaModels.map(m=> <option key={m} value={m}>{m}</option>)}
                </select>
                <Button onClick={refreshOllamaModels}>↻</Button>
              </div>
            ) : (
              <input className="rounded-xl border p-2 text-sm" placeholder="gpt-4o-mini" value={model} onChange={e=>setModel(e.target.value)} />
            )}
            <div className="text-xs text-gray-500 flex items-center">Body includes <code>{'{ provider, model }'}</code></div>
          </div>
        </Section>

        <Section title="Inputs for inference">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <TextArea placeholder="Describe your needs, goals, or problem. Example: 'Build a public REST API for orders with auth and metrics'" value={needs} onChange={e=>setNeeds(e.target.value)} />
            <TextArea placeholder="Tech stack (optional). Example: 'TypeScript, Node.js, Fastify, Postgres, Docker'" value={techStack} onChange={e=>setTechStack(e.target.value)} />
          </div>
          <div className="pt-2 flex gap-2">
            <Button onClick={inferFromInputs} className="bg-black text-white">Infer fields</Button>
            <Button onClick={suggestOptionals}>Suggest</Button>
          </div>
        </Section>

        <Section title="1. Role (optional)">
          <TextArea value={role} onChange={e=>setRole(e.target.value)} />
        </Section>

        <Section title="Tech stack (optional)">
          <TextArea value={techStack} onChange={e=>setTechStack(e.target.value)} />
        </Section>

        <Section title="2. Task">
          <TextArea value={task} onChange={e=>setTask(e.target.value)} />
        </Section>

        <Section title="3. Context">
          <TextArea value={context} onChange={e=>setContext(e.target.value)} />
        </Section>

        <Section title="4. Reasoning">
          <TextArea value={reasoning} onChange={e=>setReasoning(e.target.value)} />
        </Section>

        <Section title="5. Output format">
          <TextArea value={outputSpec} onChange={e=>setOutputSpec(e.target.value)} />
        </Section>

        <Section title="6. Stop conditions">
          <TextArea value={stop} onChange={e=>setStop(e.target.value)} />
        </Section>

        <div className="flex gap-2">
          <Button onClick={run} className="bg-black text-white">
            {running ? <Loader2 className="animate-spin inline mr-2" size={16}/> : <Play size={16} className="inline mr-2"/>}
            Generate Prompt
          </Button>
        </div>

        <Section title="Self-tests">
          <ul className="text-sm">
            {testResults.map((t,i)=> (
              <li key={i} className={`flex items-center gap-2 ${t.pass? 'text-green-700':'text-red-700'}`}>
                {t.pass? <Check size={16}/> : <X size={16}/>} {t.name}{t.pass? '' : ` — ${t.msg}`}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Chat preview (OpenAI or Ollama)">
          <ChatPreview system={promptText} provider={provider} model={model} />
        </Section>

        <Section title="Server snippets (OpenAI + Ollama)">
          <ServerSnippets />
        </Section>

        <Section title="Live prompt">
          <pre className="text-xs whitespace-pre-wrap bg-gray-900 text-gray-100 p-3 rounded-xl max-h-[500px] overflow-auto">{promptText}</pre>
        </Section>

        {result && (
          <Section title="Result">
            <div className="text-sm text-green-700 flex items-center gap-2"><Check size={16}/> Generated</div>
          </Section>
        )}
      </div>
    </div>
  );
}
