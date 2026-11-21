import React, { useEffect, useRef, useState } from 'react';
import { Clock, Send, Sparkles, Trash2 } from 'lucide-react';
import { serializeTranscriptContext, useClipMind } from '../../context/ClipMindContext';
import { streamChatWithVideo } from '../../services/geminiService';
import type { ChatMessage } from '../../types';
import { formatTimestamp } from '../../utils/youtube';
import { MarkdownView } from '../MarkdownView';

const QUICK_PROMPTS = [
  'Apa argumen utama dalam video ini?',
  'Di menit berapa dibahas poin paling penting?',
  'Buat 5 pertanyaan diskusi dari isi video',
  'Apa kelemahan atau celah argumennya?',
];

export function ChatTab() {
  const {
    youtubeUrl,
    localVideoId,
    transcript,
    videoId,
    modelMode,
    durationSec,
    currentTime,
    chat,
    setChat,
    pendingChatPrompt,
    consumePendingChatPrompt,
  } = useClipMind();

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (pendingChatPrompt) {
      setInput(pendingChatPrompt);
      consumePendingChatPrompt();
    }
  }, [pendingChatPrompt, consumePendingChatPrompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, isStreaming]);

  const sendMessage = async (textToSend?: string) => {
    const content = (textToSend ?? input).trim();
    if (!content || (!youtubeUrl && !localVideoId) || isStreaming) return;

    setError(null);
    if (!textToSend) setInput('');

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      content,
      createdAt: Date.now(),
    };

    const assistantId = `msg-${Date.now()}-a`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };

    const historyForApi = [...chat, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setChat((prev) => [...prev, userMsg, assistantPlaceholder]);
    setIsStreaming(true);

    try {
      await streamChatWithVideo({
        youtubeUrl: youtubeUrl || undefined,
        localVideoId: localVideoId || undefined,
        transcriptContextText: serializeTranscriptContext(transcript),
        messages: historyForApi,
        mode: modelMode,
        durationHint: durationSec,
        onChunk: (chunkText) => {
          setChat((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + chunkText } : m
            )
          );
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menerima balasan chat.');
      setChat((prev) => prev.filter((m) => m.id !== assistantId || m.content.length > 0));
    } finally {
      setIsStreaming(false);
    }
  };

  if (!videoId) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">
        Muat video YouTube atau impor file MP4 terlebih dahulu untuk berdiskusi langsung dengan isi video.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[560px]">
      {/* Quick Prompts & Moment Context */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.08]">
        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={isStreaming}
              onClick={() => sendMessage(q)}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-200 hover:bg-white/[0.1] disabled:opacity-40 cursor-pointer"
            >
              {q}
            </button>
          ))}
        </div>
        {chat.length > 0 && (
          <button
            type="button"
            onClick={() => setChat([])}
            aria-label="Bersihkan riwayat chat"
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-300 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Bersihkan</span>
          </button>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto py-4 space-y-3 pr-1">
        {chat.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-[#0B0D12]/60 p-5 text-sm text-slate-400 space-y-2">
            <p className="font-medium text-slate-200 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-400" />
              <span>Tanya apa saja tentang isi video ini</span>
            </p>
            <p className="text-xs leading-relaxed">
              Setiap jawaban hanya didasarkan pada isi video dan menyertakan timestamp [MM:SS] yang bisa Anda klik untuk langsung melompat ke momen tersebut.
            </p>
          </div>
        ) : (
          chat.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[88%] rounded-xl px-4 py-3 text-sm ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                    : 'border border-white/[0.08] bg-[#0B0D12] text-slate-200'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : msg.content ? (
                  <MarkdownView content={msg.content} enableTimestampChips />
                ) : (
                  <span className="text-xs text-slate-400">Menyusun jawaban…</span>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="mb-2 flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => sendMessage(chat[chat.length - 1]?.content)}
            className="underline font-semibold cursor-pointer"
          >
            Coba lagi
          </button>
        </div>
      )}

      {/* Input Area */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
        className="pt-3 border-t border-white/[0.08] space-y-2"
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() =>
              setInput(
                `Apa yang dibahas pada momen [${formatTimestamp(currentTime)}] ini?`
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-200 hover:bg-violet-500/20 cursor-pointer"
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Tanya tentang momen ini ({formatTimestamp(currentTime)})</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label="Pertanyaan tentang video"
            placeholder="Tulis pertanyaan tentang isi video…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isStreaming}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0B0D12] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            aria-label="Kirim pertanyaan"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Send className="h-4 w-4" />
            <span>Kirim</span>
          </button>
        </div>
      </form>
    </div>
  );
}
