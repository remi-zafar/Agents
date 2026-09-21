import { useEffect, useRef } from 'react';
import ToolCallCard from './ToolCallCard.jsx';

export default function Timeline({ timeline, streamingText, report, running, error, hasProject }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [timeline.length, streamingText]);

  if (!hasProject && timeline.length === 0) {
    return (
      <div className="timeline timeline-empty">
        <div className="empty-state">
          <h2>Describe it. The agent builds it.</h2>
          <p>
            Every run goes through the same loop: understand → plan → scaffold → implement →
            verify → deliver. Tool calls stream in live on the right, the generated app gets its
            own public preview URL.
          </p>
          <ul className="empty-list">
            <li>Writes real files into an isolated project workspace</li>
            <li>Starts the service and checks the port actually answers</li>
            <li>Reports only what it verified — never what it assumes</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline">
      {timeline.map((item) => {
        if (item.kind === 'user') {
          return (
            <article key={item.id} className="bubble bubble-user">
              <span className="bubble-role">you</span>
              <p>{item.text}</p>
            </article>
          );
        }
        if (item.kind === 'assistant') {
          return (
            <article key={item.id} className="bubble bubble-agent">
              <span className="bubble-role">agent</span>
              <p>{item.text}</p>
            </article>
          );
        }
        return <ToolCallCard key={item.id} call={item} />;
      })}

      {streamingText && (
        <article className="bubble bubble-agent bubble-streaming">
          <span className="bubble-role">agent</span>
          <p>
            {streamingText}
            <span className="caret" aria-hidden="true" />
          </p>
        </article>
      )}

      {running && !streamingText && (
        <div className="working" role="status">
          <span className="spinner" aria-hidden="true" /> agent is working
        </div>
      )}

      {report && <ReportCard report={report} />}
      {error && (
        <div className="alert" role="alert">
          <strong>Run error.</strong> {error}
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}

function ReportCard({ report }) {
  return (
    <article className="report">
      <h3>Run complete</h3>
      <p>{report.summary}</p>
      <dl>
        {report.verified && (
          <>
            <dt>Verified</dt>
            <dd>{report.verified}</dd>
          </>
        )}
        {report.gaps && (
          <>
            <dt>Gaps</dt>
            <dd>{report.gaps}</dd>
          </>
        )}
        {report.previewPort && (
          <>
            <dt>Preview</dt>
            <dd>port {report.previewPort}</dd>
          </>
        )}
      </dl>
    </article>
  );
}
