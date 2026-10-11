import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Cell, DocNode, ReportDoc, Run } from './model';

const PAGE_MM: Record<string, [number, number]> = { A4: [210, 297], A3: [297, 420] };

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) =>
        r.bold ? (
          <strong key={i}>{r.text}</strong>
        ) : r.italic ? (
          <em key={i}>{r.text}</em>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

function CellTd({ c, th }: { c: Cell; th?: boolean }) {
  const style: CSSProperties = { textAlign: c.align, fontWeight: c.bold ? 700 : undefined, fontStyle: c.italic ? 'italic' : undefined, background: c.fill, color: c.color };
  return th ? (
    <th colSpan={c.colSpan} style={style}>
      {c.text}
    </th>
  ) : (
    <td colSpan={c.colSpan} style={style}>
      {c.text}
    </td>
  );
}

function skipSpanned(row: Cell[]): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < row.length; i++) {
    out.push(row[i]);
    if (row[i].colSpan && row[i].colSpan! > 1) i += row[i].colSpan! - 1;
  }
  return out;
}

function Node({ n, mmToPx, ptToPx, baseFont }: { n: DocNode; mmToPx: (mm: number) => number; ptToPx: (pt: number) => number; baseFont: number }) {
  switch (n.t) {
    case 'title':
      return (
        <>
          {n.logo && <img src={n.logo} alt="" style={{ maxHeight: mmToPx(22), maxWidth: mmToPx(70), marginBottom: mmToPx(8) }} />}
          <div className="title-block">
            <div className="t">{n.title}</div>
            {n.subtitle && <div className="st">{n.subtitle}</div>}
          </div>
          {n.details.length > 0 && (
            <table className="kv">
              <tbody>
                {n.details.map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {n.pageBreakAfter && <div className="page-break" />}
        </>
      );
    case 'h': {
      const Tag = (`h${n.level}` as 'h1' | 'h2' | 'h3');
      const size = n.level === 1 ? '1.45em' : n.level === 2 ? '1.2em' : '1.05em';
      return (
        <Tag style={{ fontSize: size }}>
          {n.number ? `${n.number}  ` : ''}
          {n.text}
        </Tag>
      );
    }
    case 'p':
      return (
        <p>
          <Runs runs={n.runs} />
        </p>
      );
    case 'ul':
      return (
        <ul>
          {n.items.map((it, i) => (
            <li key={i}>
              <Runs runs={it} />
            </li>
          ))}
        </ul>
      );
    case 'note':
      return <p className="note">{n.text}</p>;
    case 'pagebreak':
      return <div className="page-break" />;
    case 'image':
      return (
        <figure style={{ margin: '0.6em 0 1em' }}>
          {n.dataUrl ? (
            <img src={n.dataUrl} alt={n.caption ?? ''} style={{ width: mmToPx(n.widthCm * 10), maxWidth: '100%', height: 'auto', display: 'block' }} />
          ) : (
            <div style={{ width: mmToPx(n.widthCm * 10), height: mmToPx(n.heightCm * 10), maxWidth: '100%', border: '1px dashed #bbb', display: 'grid', placeItems: 'center', color: '#888', fontSize: 12 }}>Graph</div>
          )}
          {n.caption && <figcaption className="caption">{n.caption}</figcaption>}
        </figure>
      );
    case 'table': {
      // Same geometry as the PDF: fixed column widths in mm, fonts in pt, scaled to the preview page.
      const allNumeric = n.widths.every((w) => typeof w === 'number');
      const totalMm = n.widths.reduce<number>((s, w) => s + (typeof w === 'number' ? w : 0), 0);
      return (
        <div style={{ margin: '0.5em 0 0.9em' }}>
          {n.caption && (
            <div className="caption" style={{ fontWeight: 600, color: '#222', marginBottom: 2 }}>
              {n.caption}
            </div>
          )}
          <table
            style={{
              fontSize: ptToPx(n.fontSize ?? baseFont - 1),
              width: allNumeric ? Math.min(mmToPx(totalMm), 100000) : '100%',
              maxWidth: '100%',
              tableLayout: 'fixed',
              ['--cell-py' as string]: `${mmToPx(0.55)}px`,
              ['--cell-px' as string]: `${mmToPx(1.05)}px`,
            }}
          >
            <colgroup>
              {n.widths.map((w, i) => (
                <col key={i} style={{ width: typeof w === 'number' ? mmToPx(w) : undefined }} />
              ))}
            </colgroup>
            <thead>
              {n.head.map((row, i) => (
                <tr key={i}>
                  {skipSpanned(row).map((c, j) => (
                    <CellTd key={j} c={c} th />
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {n.body.map((row, i) => (
                <tr key={i}>
                  {skipSpanned(row).map((c, j) => (
                    <CellTd key={j} c={c} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {n.notes?.map((t, i) => (
            <div key={i} className="note" style={{ margin: 0 }}>
              {t}
            </div>
          ))}
        </div>
      );
    }
  }
}

/** On-screen preview of a report: the page is drawn to scale and shrunk to fit the available width. */
export function ReportPreview({ doc, scale = 1 }: { doc: ReportDoc; scale?: number }) {
  const t = doc.template;
  const [w, h] = PAGE_MM[t.pageSize] ?? PAGE_MM.A4;
  const pageW = t.orientation === 'landscape' ? h : w;
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const fit = avail ? Math.min(scale, Math.max(0.3, (avail - 4) / (pageW * 3.2))) : scale;
  const pxPerMm = 3.2 * fit;
  const mmToPx = (mm: number) => mm * pxPerMm;
  const ptToPx = (pt: number) => pt * 0.3528 * pxPerMm; // 1 pt = 0.3528 mm
  return (
    <div ref={box} style={{ width: '100%' }}>
      <div
        className="report-paper"
        style={{
          width: mmToPx(pageW),
          maxWidth: '100%',
          padding: mmToPx(t.marginMm),
          fontSize: `${ptToPx(t.fontSize)}px`,
          ['--report-accent' as string]: t.accent,
        }}
      >
        {(doc.header || doc.footer) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75em', color: '#777', borderBottom: '0.5px solid #ddd', paddingBottom: 4, marginBottom: 12 }}>
            <span>{doc.header}</span>
            <span>{doc.footer}</span>
          </div>
        )}
        {doc.nodes.map((n, i) => (
          <Node key={i} n={n} mmToPx={mmToPx} ptToPx={ptToPx} baseFont={t.fontSize} />
        ))}
      </div>
    </div>
  );
}
