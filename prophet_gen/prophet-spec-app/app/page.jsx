"use client";

import React, { useState } from "react";
import { FileText, Loader2, Printer, Copy, ArrowLeft, Check, AlertTriangle, ChevronDown, ChevronRight, UploadCloud, X } from "lucide-react";

/* ------------------------------------------------------------------ *
 *  Prophet 모델 명세서 생성기 (배포용 Next.js 앱)
 *  PDF 업로드 → ① 사실 추출 → ② 영역 설계 → ③ 변수 생성 → 명세서
 *  Anthropic API 호출은 서버(/api/claude)가 키를 들고 대행합니다.
 * ------------------------------------------------------------------ */

const FACTS_SYS = `당신은 한국 생명·건강보험 계리사입니다. 첨부된 보험 약관·기초서류(사업방법서/산출방법서) PDF를 읽고, FIS Prophet 계리모델링에 필요한 상품 핵심 사실을 "약관 조항 번호와 함께" 간결히 요약합니다.
반드시 포함: 상품명·유형 / 담보 목록(주계약·특약, 의무부가·선택 구분, 각 지급사유) / 가입금액·기준 / 납입기간·보험기간·갱신 여부 / 면책(대기)기간 / 최저보증(있으면 종류·기준) / 적립·연금 구조와 단계(연금개시 전·후 등) / 사업비·해지환급금 관련 조항.
PDF에서 실제로 확인된 사실만 적고, 불명확하면 "약관상 불명확"으로 표기. 추측 금지.
출력은 JSON만(코드펜스·설명 없이): {"product":"상품명","tags":["태그","..."],"facts":"조항 번호를 포함한 핵심 사실 요약 텍스트"}`;

const STRUCT_SYS = `당신은 한국 생명·건강보험 계리사입니다. 주어진 "상품 핵심 사실"을 바탕으로, FIS Prophet 계리모델링에 필요한 "모델링 영역(섹션)"과 각 영역의 체크리스트 항목을 설계합니다.
표준 골격(입력 / 상수 / 시간 인덱스 / 테이블 바인딩 / 감소율(유지·사망·해약) / 급부 지급 / 보험료 / 사업비 / 현금흐름 / 준비금 / 할인 / K-IFRS17 BEL·RA·CSM)을 기본으로 하되, 상품 특성에 맞게 영역을 가감·재구성하세요.
- 변액·저축성: "특별계정·펀드 투영" 영역 + 계약자적립액 롤포워드
- 연금: 연금개시 전·후 단계(PHASE) 분기, 최저보증연금/연금기준금액
- 암·건강: 담보별 발생률(진단·수술·입원) 영역, 면책기간 처리
- 최저보증(GMxB): 보증 정의·보증비용·보증 초과지급 영역
영역 8~11개, 각 영역에 체크리스트 항목 1~6개.
출력은 JSON만(코드펜스·설명 없이): {"areas":[{"name":"영역명","items":["체크리스트항목","..."]}]}`;

const VAR_SYS = `당신은 한국 생명·건강보험 계리사입니다. 주어진 상품의 특정 "영역"에 대해 FIS Prophet 모델링 변수들을 설계합니다.
각 변수 필드:
- name: 영문 UPPER_SNAKE_CASE. 시점(매월 변하는) 변수는 끝에 _T.
- type: Input / Parameter(상수) / MS(시점) / Boolean / Numeric(집계) / TableRef / Status 중 하나
- meaning: 한국어 한 줄. 가능하면 약관 조항 근거를 함께 언급.
- formula: Prophet 유사 pseudo-code.
컨벤션: PREVIOUS(var), TABLE("id", key1, key2), SUM(expr), SUM_FROM_T(expr), IF(cond, a, b), MAX/MIN, FLOOR, ^(거듭제곱). t = 월 인덱스(0-based). 연→월 환산은 1-(1-q)^(1/12).
규칙: 회사 고유 가정값은 샘플 숫자 + 주석 "// 샘플 — 산출방법서·경험자료로 교체". 산출방법서 미보유로 근사하면 meaning에 "근사" 명시. 이미 생성된 변수명을 참조해 의존성 일관 유지. 한 영역당 변수 4~9개, meaning 간결히.
출력은 JSON 배열만(코드펜스·설명 없이): [{"name":"...","type":"...","meaning":"...","formula":"..."}]`;

const PRODUCT_TYPES = [
  "자동 판별",
  "암·건강보험 (진단·수술·입원)",
  "변액유니버설·종신",
  "변액연금",
  "일반 종신·정기보험",
  "저축성·연금(일반계정)",
  "실손·기타",
];

function stripToJSON(text) {
  let t = (text || "").trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const sObj = t.indexOf("{"), sArr = t.indexOf("[");
  const starts = [sObj, sArr].filter((i) => i >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

function readFileB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(new Error("파일 읽기 실패: " + file.name));
    r.readAsDataURL(file);
  });
}

function Formula({ text }) {
  const idx = text.indexOf("//");
  if (idx === -1) return <code className="frm">{text}</code>;
  return (
    <code className="frm">
      {text.slice(0, idx)}
      <span className="frm-cmt">{text.slice(idx)}</span>
    </code>
  );
}

function FileBucket({ label, hint, files, onAdd, onRemove, accentId }) {
  return (
    <div className="bucket">
      <label className="lbl">{label} <span className="hint">{hint}</span></label>
      <label className="drop" htmlFor={accentId}>
        <UploadCloud size={18} />
        <span>PDF 선택 또는 끌어다 놓기</span>
        <input id={accentId} type="file" accept=".pdf,application/pdf" multiple style={{ display: "none" }}
          onChange={(e) => { onAdd(Array.from(e.target.files || [])); e.target.value = ""; }} />
      </label>
      {files.length > 0 && (
        <ul className="filelist">
          {files.map((f, i) => (
            <li key={i}>
              <FileText size={14} />
              <span className="fname">{f.name}</span>
              <span className="fsize">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <button className="frm-x" onClick={() => onRemove(i)} aria-label="remove"><X size={13} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function App() {
  const [stage, setStage] = useState("input");
  const [name, setName] = useState("");
  const [ptype, setPtype] = useState(PRODUCT_TYPES[0]);
  const [termsFiles, setTermsFiles] = useState([]);
  const [basisFiles, setBasisFiles] = useState([]);
  const [notes, setNotes] = useState("");
  const [demoKey, setDemoKey] = useState("");

  const [meta, setMeta] = useState({ product: "", tags: [] });
  const [facts, setFacts] = useState("");
  const [areas, setAreas] = useState([]);
  const [progress, setProgress] = useState(0);
  const [statusLabel, setStatusLabel] = useState("");
  const [error, setError] = useState(null);
  const [toast, setToast] = useState("");
  const [showEngine, setShowEngine] = useState(false);
  const [showFacts, setShowFacts] = useState(true);

  const allFiles = [...termsFiles, ...basisFiles];
  const totalMB = allFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024;
  const totalVars = areas.reduce((n, a) => n + (a.vars ? a.vars.length : 0), 0);
  const canRun = allFiles.length > 0;

  function flash(m) { setToast(m); setTimeout(() => setToast(""), 2200); }

  async function callClaude(system, content, max_tokens) {
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: { "content-type": "application/json", ...(demoKey ? { "x-demo-key": demoKey } : {}) },
      body: JSON.stringify({ system, content, max_tokens }),
    });
    let data;
    try { data = await res.json(); } catch (e) { throw new Error("서버 응답 오류 (" + res.status + ")"); }
    if (!res.ok) throw new Error(data.error || "오류 (" + res.status + ")");
    return data.text;
  }

  async function runAnalysis() {
    setStage("analyzing");
    setError(null); setProgress(0); setAreas([]); setFacts("");
    try {
      setStatusLabel("약관·기초서류 읽는 중…");
      const docBlocks = [];
      for (const f of allFiles) {
        const b64 = await readFileB64(f);
        docBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } });
      }

      setStatusLabel("약관에서 상품 핵심 사실 추출 중…");
      setProgress(8);
      const typeHint = ptype === "자동 판별" ? "(약관 내용으로 유형 판별)" : ptype;
      const factsRaw = await callClaude(FACTS_SYS, [
        ...docBlocks,
        { type: "text", text: `상품명 힌트: ${name || "(약관에서 추출)"}\n상품유형 힌트: ${typeHint}\n추가 메모: ${notes || "(없음)"}\n\n첨부 약관·기초서류를 읽고 모델링용 핵심 사실을 JSON으로 요약하세요.` },
      ], 1600);
      const f0 = stripToJSON(factsRaw);
      const product = f0.product || name || "미지정 상품";
      const tags = Array.isArray(f0.tags) ? f0.tags : [];
      const factsText = f0.facts || "";
      setMeta({ product, tags });
      setFacts(factsText);

      setStatusLabel("모델링 영역 설계 중…");
      setProgress(20);
      const structRaw = await callClaude(STRUCT_SYS, [
        { type: "text", text: `상품: ${product} (${tags.join(" · ")})\n상품유형: ${typeHint}\n\n[상품 핵심 사실]\n${factsText}\n\n위 사실 기반으로 모델링 영역과 체크리스트를 JSON으로 설계하세요.` },
      ], 1400);
      const struct = stripToJSON(structRaw);
      const list = Array.isArray(struct.areas) ? struct.areas : [];
      if (!list.length) throw new Error("영역 구조를 생성하지 못했습니다. 약관 파일이 읽혔는지 확인하고 다시 시도해 주세요.");

      const built = [];
      const prior = [];
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        setStatusLabel(`영역 설계 중 (${i + 1}/${list.length}) · ${a.name}`);
        setProgress(20 + Math.round((i / list.length) * 78));
        let vars = [];
        try {
          const raw = await callClaude(VAR_SYS, [
            { type: "text", text: `상품: ${product} (${tags.join(" · ")})\n[상품 핵심 사실]\n${factsText}\n\n영역: ${a.name}\n체크리스트 항목: ${(a.items || []).join(", ")}\n이미 생성된 변수명(참조용): ${prior.slice(-40).join(", ") || "(없음)"}\n이 영역의 변수들을 설계해 JSON 배열로 출력.` },
          ], 2600);
          const parsed = stripToJSON(raw);
          vars = Array.isArray(parsed) ? parsed : [];
        } catch (e) { vars = []; }
        vars.forEach((v) => v && v.name && prior.push(v.name));
        built.push({ ...a, vars });
        setAreas([...built]);
      }
      setProgress(100);
      setStage("spec");
    } catch (e) {
      setError(e.message || String(e));
      setStage("input");
    }
  }

  function toMarkdown() {
    let md = `# Prophet 모델 명세서\n\n**${meta.product}**\n\n${meta.tags.join(" · ")}\n\n변수 ${totalVars}개\n\n## 추출된 상품 사실 (약관 검증용)\n\n${facts}\n`;
    areas.forEach((a, i) => {
      md += `\n## ${i + 1}. ${a.name}\n\n| 변수명 | 타입 | 의미 | 포뮬라 |\n|---|---|---|---|\n`;
      (a.vars || []).forEach((v) => {
        md += `| \`${v.name}\` | ${v.type} | ${(v.meaning || "").replace(/\|/g, "/")} | \`${(v.formula || "").replace(/\|/g, "/")}\` |\n`;
      });
    });
    md += `\n---\n※ 가정값은 샘플 — 회사 경험자료로 교체 후 검증 필수. AI 초안이며 선임계리사 검증을 대체하지 않음.\n`;
    return md;
  }

  async function copyMarkdown() {
    try { await navigator.clipboard.writeText(toMarkdown()); flash("마크다운을 복사했습니다"); }
    catch (e) { flash("복사 실패 — 브라우저 권한을 확인하세요"); }
  }

  function reset() { setStage("input"); setAreas([]); setProgress(0); setError(null); }

  return (
    <div className="root">
      <style>{CSS}</style>

      {stage === "input" && (
        <div className="wrap">
          <header className="head no-print">
            <div className="eyebrow">PROPHET MODELING ASSIST · 약관 업로드 → 명세서</div>
            <h1 className="title">약관을 올리면,<br /><span className="ital">모델링 변수와 로직을 설계</span>합니다.</h1>
            <p className="lede">보험약관 PDF를 업로드하면 AI가 약관에서 상품 구조를 추출해 Prophet 모델 명세서 초안을 만듭니다. 추출된 사실을 약관과 대조해 <b>구조가 맞게 잡혔는지 검증</b>하는 용도로 써 보세요.</p>
          </header>

          {error && <div className="err no-print"><AlertTriangle size={16} /> <span>{error}</span></div>}

          <div className="card no-print">
            <FileBucket label="약관 (필수)" hint="PDF · 여러 개 가능" files={termsFiles} accentId="terms-input"
              onAdd={(fs) => setTermsFiles((p) => [...p, ...fs])} onRemove={(i) => setTermsFiles((p) => p.filter((_, j) => j !== i))} />
            <FileBucket label="기초서류 (선택)" hint="사업방법서·산출방법서 등 · 사내 기밀이면 사내망 버전 권장" files={basisFiles} accentId="basis-input"
              onAdd={(fs) => setBasisFiles((p) => [...p, ...fs])} onRemove={(i) => setBasisFiles((p) => p.filter((_, j) => j !== i))} />

            {totalMB > 4 && (
              <div className="sizewarn"><AlertTriangle size={14} /> 업로드 용량 {totalMB.toFixed(1)} MB — 일부 호스트(Vercel 서버리스)는 요청 본문 약 4.5MB 제한이 있어 대용량·스캔 약관은 실패할 수 있습니다. 핵심 장 위주 PDF를 쓰거나 자체 Node 서버에 배포하세요. (README 참고)</div>
            )}

            <div className="row2">
              <div>
                <label className="lbl">상품명 <span className="hint">(선택 — 자동 추출)</span></label>
                <input className="inp" placeholder="예: 미래에셋생명 …" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="lbl">상품 유형</label>
                <select className="inp" value={ptype} onChange={(e) => setPtype(e.target.value)}>
                  {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <label className="lbl">추가 메모 <span className="hint">(선택)</span></label>
            <textarea className="ta" rows={2} placeholder="예: 주계약 진단담보 중심으로만 등" value={notes} onChange={(e) => setNotes(e.target.value)} />

            <label className="lbl">접근 암호 <span className="hint">(배포자가 설정한 경우 입력)</span></label>
            <input className="inp" type="password" placeholder="필요 시 입력" value={demoKey} onChange={(e) => setDemoKey(e.target.value)} />

            <button className="cta" onClick={runAnalysis} disabled={!canRun}>
              <FileText size={17} /> {canRun ? "약관 분석 · 명세서 생성" : "약관 PDF를 먼저 올려 주세요"}
            </button>
            <p className="microcopy">생성물은 <b>초안</b>입니다. Prophet 문법 검증·회사 경험가정 교체·계리 검증은 사람이 수행합니다. 공개 약관 용도이며, 입력 문서는 분석을 위해 Anthropic API로 전송됩니다.</p>
          </div>

          <div className="engine no-print">
            <button className="engine-toggle" onClick={() => setShowEngine((s) => !s)}>
              {showEngine ? <ChevronDown size={15} /> : <ChevronRight size={15} />} 엔진 프롬프트 보기 (사내망·FastAPI 포팅용)
            </button>
            {showEngine && (
              <div className="engine-body">
                <p className="engine-note">세 프롬프트가 핵심입니다. 사내 LLM·FastAPI에 이식하면 폐쇄망에서 동일 파이프라인을 재현할 수 있습니다.</p>
                <div className="engine-block"><div className="engine-h">① 사실 추출 (PDF 입력)</div><pre>{FACTS_SYS}</pre></div>
                <div className="engine-block"><div className="engine-h">② 영역 설계</div><pre>{STRUCT_SYS}</pre></div>
                <div className="engine-block"><div className="engine-h">③ 변수·포뮬라 설계</div><pre>{VAR_SYS}</pre></div>
              </div>
            )}
          </div>
        </div>
      )}

      {stage === "analyzing" && (
        <div className="wrap analyzing">
          <div className="ana-card">
            <div className="ana-icon"><Loader2 className="spin" size={22} /></div>
            <div className="ana-title">{meta.product || name || "상품"} 분석 중</div>
            <div className="ana-status">{statusLabel}</div>
            <div className="bar"><div className="bar-fill" style={{ width: progress + "%" }} /></div>
            <div className="ana-pct">{progress}%</div>
            {areas.length > 0 && (
              <ul className="ana-list">
                {areas.map((a, i) => <li key={i}><Check size={13} /> {a.name} <span className="ana-cnt">· 변수 {(a.vars || []).length}</span></li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      {stage === "spec" && (
        <div className="wrap">
          <div className="toolbar no-print">
            <button className="tbtn ghost" onClick={reset}><ArrowLeft size={15} /> 새 명세서</button>
            <div className="tspacer" />
            <button className="tbtn" onClick={copyMarkdown}><Copy size={15} /> 마크다운 복사</button>
            <button className="tbtn" onClick={() => window.print()}><Printer size={15} /> 인쇄 · PDF</button>
          </div>

          <article className="spec">
            <div className="spec-eyebrow">PROPHET 모델 명세서 · 생성일 {new Date().toLocaleDateString("ko-KR")}</div>
            <h2 className="spec-title">{meta.product}</h2>
            <div className="spec-tags">{meta.tags.join("  ·  ")}</div>
            <div className="spec-meta"><span><b>{areas.length}</b> 개 영역</span><span><b>{totalVars}</b> 개 변수</span></div>

            {facts && (
              <div className="facts">
                <button className="facts-head no-print" onClick={() => setShowFacts((s) => !s)}>
                  {showFacts ? <ChevronDown size={15} /> : <ChevronRight size={15} />} 추출된 상품 사실 — <b>약관과 대조해 먼저 검증하세요</b>
                </button>
                <div className="facts-head print-only">추출된 상품 사실 (약관 검증용)</div>
                {showFacts && <div className="facts-body">{facts}</div>}
              </div>
            )}

            <p className="spec-note">본 명세서는 Prophet 모델링을 위한 변수·포뮬라·의존성 참고서입니다. Prophet 유사 pseudo-code로 작성되었으며, 최종 투입 전 문법 검증이 필요합니다.</p>

            {areas.map((a, i) => (
              <section className="area" key={i}>
                <div className="area-head">
                  <span className="area-no">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="area-name">{a.name}</h3>
                  <span className="area-cnt">변수 {(a.vars || []).length}</span>
                </div>
                <div className="tbl">
                  <div className="tr th"><div className="c-name">변수명</div><div className="c-type">타입</div><div className="c-mean">의미</div><div className="c-frm">포뮬라</div></div>
                  {(a.vars || []).map((v, j) => (
                    <div className="tr" key={j}>
                      <div className="c-name"><code className="vname">{v.name}</code></div>
                      <div className="c-type">{v.type}</div>
                      <div className="c-mean">{v.meaning}</div>
                      <div className="c-frm"><Formula text={v.formula || ""} /></div>
                    </div>
                  ))}
                  {(!a.vars || a.vars.length === 0) && <div className="tr empty">이 영역은 생성에 실패했습니다. 새 명세서에서 다시 시도해 보세요.</div>}
                </div>
              </section>
            ))}

            <div className="conv"><b>포뮬라 컨벤션</b> · PREVIOUS(var), TABLE("id", key…), SUM(expr), SUM_FROM_T(expr), IF(cond, a, b), MAX/MIN, FLOOR, ^(거듭제곱). t = 월 인덱스(0-based).</div>
            <div className="warn"><AlertTriangle size={14} /> 가정 테이블·요율 값은 <b>샘플</b>입니다. 회사 경험자료·산출방법서로 교체 후 검증 필수. 본 산출물은 AI 초안이며, 선임계리사 검증·거버넌스 절차를 대체하지 않습니다.</div>
          </article>
        </div>
      )}

      {toast && <div className="toast no-print">{toast}</div>}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,600;1,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
:root{ --ink:#16202e; --ink2:#51607a; --paper:#eceef2; --surface:#ffffff; --brass:#9a6f2e; --line:#d8dde5; --code:#f2f5f8; --flag:#a8541f;
  --serif:'Spectral', Georgia, 'Apple SD Gothic Neo','Malgun Gothic', serif;
  --sans:'Inter', -apple-system, 'Segoe UI', Roboto, 'Apple SD Gothic Neo','Malgun Gothic', sans-serif;
  --mono:'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace; }
*{box-sizing:border-box;}
.root{ font-family:var(--sans); color:var(--ink); background:var(--paper); min-height:100vh; line-height:1.5; }
.wrap{ max-width:1080px; margin:0 auto; padding:34px 22px 80px; }
.eyebrow{ font:600 11px/1 var(--sans); letter-spacing:.16em; color:var(--brass); text-transform:uppercase; margin-bottom:18px; }
.title{ font:600 40px/1.08 var(--serif); letter-spacing:-.01em; margin:0 0 14px; }
.title .ital{ font-style:italic; font-weight:500; color:var(--brass); }
.lede{ max-width:660px; color:var(--ink2); font-size:15px; margin:0 0 26px; }
.card{ background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:24px; box-shadow:0 18px 40px -32px rgba(22,32,46,.35); }
.lbl{ display:block; font:600 12px/1 var(--sans); color:var(--ink); margin:0 0 9px; }
.hint{ font-weight:400; color:var(--ink2); }
.bucket{ margin-bottom:20px; }
.drop{ display:flex; align-items:center; justify-content:center; gap:9px; border:1.5px dashed #c2cad6; border-radius:11px; padding:20px; color:var(--ink2); font-size:13.5px; cursor:pointer; background:#fafbfc; transition:all .15s; }
.drop:hover{ border-color:var(--brass); color:var(--ink); background:#fcfaf5; } .drop svg{ color:var(--brass); }
.filelist{ list-style:none; padding:0; margin:10px 0 0; }
.filelist li{ display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--ink); padding:7px 10px; border:1px solid var(--line); border-radius:8px; margin-top:6px; background:#fcfdfe; }
.filelist li svg{ color:var(--ink2); flex:none; }
.fname{ flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .fsize{ color:var(--ink2); font:500 11px var(--mono); flex:none; }
.frm-x{ background:none; border:none; color:var(--ink2); cursor:pointer; padding:2px; display:flex; } .frm-x:hover{ color:var(--flag); }
.sizewarn{ display:flex; align-items:flex-start; gap:7px; font-size:12px; color:#7a3f15; background:#fcf4ec; border:1px solid #ecd6bf; border-radius:9px; padding:10px 12px; line-height:1.55; margin-bottom:18px; }
.sizewarn svg{ flex:none; margin-top:1px; color:var(--flag); }
.row2{ display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:18px; }
.inp,.ta,select.inp{ width:100%; border:1px solid var(--line); border-radius:9px; padding:11px 13px; font-family:var(--sans); font-size:14px; color:var(--ink); background:#fcfdfe; outline:none; transition:border-color .15s, box-shadow .15s; }
.inp:focus,.ta:focus,select.inp:focus{ border-color:var(--brass); box-shadow:0 0 0 3px rgba(154,111,46,.13); }
.ta{ resize:vertical; line-height:1.55; margin-bottom:18px; }
input[type=password].inp{ margin-bottom:4px; }
.cta{ margin-top:14px; width:100%; display:flex; align-items:center; justify-content:center; gap:8px; background:var(--brass); color:#fff; border:none; border-radius:10px; padding:14px; font:600 15px var(--sans); cursor:pointer; transition:filter .15s, transform .05s; }
.cta:hover{ filter:brightness(1.06); } .cta:active{ transform:translateY(1px); } .cta:disabled{ background:#c7ccd5; cursor:not-allowed; }
.microcopy{ margin:13px 0 0; font-size:12px; color:var(--ink2); text-align:center; line-height:1.6; }
.err{ display:flex; align-items:center; gap:8px; background:#fcefe8; border:1px solid #e6c3ab; color:#9a3d10; border-radius:10px; padding:11px 14px; font-size:13.5px; margin-bottom:18px; }
.engine{ margin-top:20px; }
.engine-toggle{ display:inline-flex; align-items:center; gap:6px; background:none; border:none; color:var(--ink2); font:500 13px var(--sans); cursor:pointer; padding:6px 0; } .engine-toggle:hover{ color:var(--brass); }
.engine-body{ margin-top:10px; border:1px solid var(--line); border-radius:12px; background:var(--surface); padding:16px; }
.engine-note{ font-size:12.5px; color:var(--ink2); margin:0 0 12px; }
.engine-block{ margin-top:12px; } .engine-h{ font:600 12px var(--sans); color:var(--brass); margin-bottom:6px; }
.engine-body pre{ background:#11161f; color:#dfe6f0; border-radius:8px; padding:13px; font:400 11.5px/1.5 var(--mono); white-space:pre-wrap; overflow-x:auto; margin:0; }
.analyzing{ min-height:62vh; display:flex; align-items:center; justify-content:center; }
.ana-card{ width:100%; max-width:520px; background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:34px 30px; text-align:center; box-shadow:0 24px 50px -38px rgba(22,32,46,.5); }
.ana-icon{ color:var(--brass); margin-bottom:14px; } .spin{ animation:spin 1s linear infinite; } @keyframes spin{ to{ transform:rotate(360deg);} }
.ana-title{ font:600 21px var(--serif); margin-bottom:6px; } .ana-status{ font-size:13.5px; color:var(--ink2); margin-bottom:18px; min-height:20px; }
.bar{ height:7px; background:#e7eaef; border-radius:99px; overflow:hidden; } .bar-fill{ height:100%; background:linear-gradient(90deg,#b88c45,var(--brass)); border-radius:99px; transition:width .4s ease; }
.ana-pct{ font:600 13px var(--mono); color:var(--brass); margin-top:10px; }
.ana-list{ list-style:none; padding:0; margin:20px 0 0; text-align:left; }
.ana-list li{ display:flex; align-items:center; gap:7px; font-size:13px; color:var(--ink); padding:5px 0; border-top:1px solid var(--line); } .ana-list li svg{ color:#2e8b57; flex:none; } .ana-cnt{ color:var(--ink2); font-size:12px; }
.toolbar{ position:sticky; top:0; z-index:5; display:flex; align-items:center; gap:9px; padding:13px 0; margin-bottom:6px; background:linear-gradient(var(--paper) 70%, rgba(236,238,242,0)); } .tspacer{ flex:1; }
.tbtn{ display:inline-flex; align-items:center; gap:7px; background:var(--ink); color:#fff; border:none; border-radius:9px; padding:9px 14px; font:500 13px var(--sans); cursor:pointer; transition:filter .15s; } .tbtn:hover{ filter:brightness(1.15); }
.tbtn.ghost{ background:transparent; color:var(--ink2); border:1px solid var(--line); } .tbtn.ghost:hover{ color:var(--ink); border-color:var(--ink2); }
.spec{ background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:42px 44px; }
.spec-eyebrow{ font:500 11px/1 var(--mono); letter-spacing:.04em; color:var(--ink2); text-transform:uppercase; margin-bottom:16px; }
.spec-title{ font:600 30px/1.15 var(--serif); margin:0 0 8px; } .spec-tags{ font-size:13px; color:var(--ink2); margin-bottom:16px; }
.spec-meta{ display:flex; gap:22px; padding:12px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); font-size:13px; color:var(--ink2); } .spec-meta b{ color:var(--brass); font:600 16px var(--mono); margin-right:3px; }
.facts{ margin-top:18px; border:1px solid #e6dcc8; border-radius:11px; background:#fdfbf6; overflow:hidden; }
.facts-head{ width:100%; display:flex; align-items:center; gap:7px; background:none; border:none; text-align:left; cursor:pointer; padding:13px 16px; font:500 13px var(--sans); color:var(--ink); } .facts-head b{ color:var(--brass); } .facts-head:hover{ background:#faf5ea; }
.facts-body{ padding:4px 18px 18px; font-size:12.5px; line-height:1.7; color:var(--ink); white-space:pre-wrap; border-top:1px solid #efe6d4; }
.print-only{ display:none; }
.spec-note{ font-size:12.5px; color:var(--ink2); margin:18px 0 28px; line-height:1.6; }
.area{ margin-bottom:30px; } .area-head{ display:flex; align-items:baseline; gap:12px; border-bottom:2px solid var(--ink); padding-bottom:7px; }
.area-no{ font:600 13px var(--mono); color:var(--brass); } .area-name{ font:600 16px var(--serif); margin:0; flex:1; } .area-cnt{ font:500 11px var(--mono); color:var(--ink2); }
.tbl{ width:100%; }
.tr{ display:grid; grid-template-columns:1.7fr .9fr 2.3fr 3.1fr; border-bottom:1px solid var(--line); }
.tr.th{ background:#f7f8fa; font:600 11px var(--sans); letter-spacing:.03em; color:var(--ink2); text-transform:uppercase; } .tr.th>div{ padding:8px 10px; }
.tr:not(.th)>div{ padding:11px 10px; font-size:12.5px; align-self:start; } .tr:not(.th):hover{ background:#fafbfc; }
.c-name .vname{ font:600 12px var(--mono); color:var(--ink); word-break:break-all; } .c-type{ color:var(--ink2); font-size:11.5px; } .c-mean{ color:var(--ink); line-height:1.5; }
.frm{ font:400 11.5px/1.5 var(--mono); color:#1d3a5f; background:var(--code); padding:2px 5px; border-radius:5px; display:inline-block; word-break:break-word; white-space:pre-wrap; } .frm-cmt{ color:var(--flag); }
.tr.empty{ display:block; padding:14px 10px; color:var(--ink2); font-size:12.5px; font-style:italic; }
.conv{ font-size:11.5px; color:var(--ink2); background:#f7f8fa; border:1px solid var(--line); border-radius:8px; padding:11px 13px; line-height:1.6; margin-top:24px; } .conv b{ color:var(--ink); }
.warn{ display:flex; align-items:flex-start; gap:8px; font-size:11.5px; color:#7a3f15; background:#fcf4ec; border:1px solid #ecd6bf; border-radius:8px; padding:11px 13px; line-height:1.6; margin-top:10px; } .warn svg{ flex:none; margin-top:1px; color:var(--flag); } .warn b{ color:#7a3f15; }
.toast{ position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:var(--ink); color:#fff; padding:11px 18px; border-radius:10px; font-size:13px; z-index:50; box-shadow:0 10px 30px -10px rgba(0,0,0,.4); }
@media (max-width:720px){ .title{ font-size:31px; } .spec{ padding:24px 18px; } .row2{ grid-template-columns:1fr; } .tr{ grid-template-columns:1fr; } .tr.th{ display:none; } .tr:not(.th){ padding:10px 0; } .tr:not(.th)>div{ padding:3px 0; } .c-type::before{ content:'타입 · '; color:var(--ink2); } }
@media print{ .no-print{ display:none !important; } .print-only{ display:block !important; padding:13px 16px; font:600 13px var(--sans); } .root,.wrap{ background:#fff; padding:0; max-width:none; } .spec{ border:none; box-shadow:none; padding:0; } .tr:hover{ background:none; } .area,.facts{ break-inside:avoid; } }
`;
