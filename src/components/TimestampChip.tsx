import { Play } from 'lucide-react';
import { useClipMind } from '../context/ClipMindContext';
import { formatTimestamp } from '../utils/youtube';

interface TimestampChipProps {
  seconds: number;
  label?: string;
}

export function TimestampChip({ seconds, label }: TimestampChipProps) {
  const { seekTo } = useClipMind();
  const display = label ?? formatTimestamp(seconds);

  return (
    <button
      type="button"
      onClick={() => seekTo(seconds, true)}
      aria-label={`Lompat ke menit ${display}`}
      className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 px-2 py-0.5 font-mono text-xs font-medium text-violet-300 tabular-nums transition-colors hover:bg-violet-500/30 hover:text-white focus-visible:outline-2 focus-visible:outline-violet-400 cursor-pointer whitespace-nowrap shrink-0"
    >
      <Play className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
      <span>{display}</span>
    </button>
  );
}
