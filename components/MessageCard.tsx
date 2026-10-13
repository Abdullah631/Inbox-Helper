import type { GroupedItem } from "@/lib/group";
import { LOW_CONFIDENCE } from "@/lib/flags";
import type { Flag } from "@/lib/schema";

const FLAG_UI: Record<Flag, { label: string; tone: string }> = {
  possible_injection: { label: "Possible injection", tone: "badge-danger" },
  needs_human: { label: "Needs a person", tone: "badge-warn" },
  low_confidence: { label: "Low confidence", tone: "badge-warn" },
};

export function MessageCard({ item }: { item: GroupedItem }) {
  const { message: m, classification: c } = item;
  const pct = Math.round(c.confidence * 100);
  const tone = c.flags.includes("possible_injection") ? " injection" : c.flags.length ? " flagged" : "";

  return (
    <article className={`card msg${tone}`}>
      <div className="msg-top">
        <div className="msg-from">
          <strong>{m.from}</strong>
          {m.subject && <span> &middot; {m.subject}</span>}
        </div>
        <div className="msg-meta">
          {c.flags.map((f) => (
            <span key={f} className={`badge ${FLAG_UI[f].tone}`}>{FLAG_UI[f].label}</span>
          ))}
          <span className="meter" title={`Confidence ${pct}%`}>
            <span className="meter-track">
              <span className={`meter-fill${c.confidence < LOW_CONFIDENCE ? " low" : ""}`} style={{ width: `${pct}%`, display: "block" }} />
            </span>
            {pct}%
          </span>
        </div>
      </div>
      <p className="msg-body">{m.body}</p>
      <div className="msg-reason">
        <span className="badge">{c.method === "llm" ? "AI" : "Keywords"}</span>
        <span>{c.reason}</span>
      </div>
    </article>
  );
}
