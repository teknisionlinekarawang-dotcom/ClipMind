import React from 'react';
import { TimestampChip } from './TimestampChip';
import { parseTimestamp } from '../utils/youtube';

interface MarkdownViewProps {
  content: string;
  enableTimestampChips?: boolean;
}

function renderInline(text: string, enableTimestampChips: boolean): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  // Match [MM:SS] or [H:MM:SS] or **bold** or `code`
  const pattern = /(\[\d{1,2}:\d{2}(?::\d{2})?\]|\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (enableTimestampChips && token.startsWith('[') && token.endsWith(']')) {
      const inner = token.slice(1, -1);
      const sec = parseTimestamp(inner);
      if (sec !== null) {
        tokens.push(<TimestampChip key={`ts-${keyIdx++}`} seconds={sec} label={inner} />);
      } else {
        tokens.push(token);
      }
    } else if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push(
        <strong key={`b-${keyIdx++}`} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push(
        <code
          key={`c-${keyIdx++}`}
          className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-violet-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else {
      tokens.push(token);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return tokens;
}

export function MarkdownView({
  content,
  enableTimestampChips = true,
}: MarkdownViewProps) {
  const lines = content.split('\n');

  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-slate-200">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={i} className="h-1" />;
        }
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={i} className="pt-2 font-display text-base font-semibold text-white">
              {renderInline(trimmed.slice(4), enableTimestampChips)}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={i} className="pt-3 font-display text-lg font-semibold text-white">
              {renderInline(trimmed.slice(3), enableTimestampChips)}
            </h3>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={i} className="pt-2 font-display text-xl font-bold text-white">
              {renderInline(trimmed.slice(2), enableTimestampChips)}
            </h2>
          );
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={i} className="flex items-start gap-2 pl-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" aria-hidden="true" />
              <p className="flex-1">{renderInline(trimmed.slice(2), enableTimestampChips)}</p>
            </div>
          );
        }
        return <p key={i}>{renderInline(trimmed, enableTimestampChips)}</p>;
      })}
    </div>
  );
}
