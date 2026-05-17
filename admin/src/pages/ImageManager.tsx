import { ChangeEvent, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface UploadResp {
  uploaded: { url: string; filename: string; size: number }[];
}

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

export default function ImageManager({ value, onChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append('files', f);
      const resp = await api.postFormData<UploadResp>('/admin/uploads', form);
      onChange([...value, ...resp.uploaded.map((u) => u.url)]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  function setCover(i: number) {
    if (i === 0) return;
    const next = [...value];
    const [picked] = next.splice(i, 1);
    next.unshift(picked);
    onChange(next);
  }

  function moveLeft(i: number) {
    if (i === 0) return;
    const next = [...value];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  }

  function moveRight(i: number) {
    if (i === value.length - 1) return;
    const next = [...value];
    [next[i + 1], next[i]] = [next[i], next[i + 1]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        onChange={onPickFiles}
        disabled={uploading}
        className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-brand-indigo file:text-white file:font-medium hover:file:bg-brand-indigo-dark file:cursor-pointer"
      />
      {uploading && <p className="text-xs text-slate-500">Uploading…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {value.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {value.map((url, i) => (
            <div
              key={url}
              className="relative border border-slate-200 rounded overflow-hidden bg-slate-50 aspect-square group"
            >
              <img src={url} alt={`image ${i + 1}`} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removeAt(i)}
                title="Remove"
                className="absolute top-1 right-1 px-1.5 py-0.5 text-xs bg-red-600 text-white rounded shadow"
              >
                ×
              </button>
              {i === 0 ? (
                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 text-[10px] bg-brand-indigo-dark text-white rounded">
                  cover
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setCover(i)}
                  title="Make cover"
                  className="absolute bottom-1 left-1 px-1.5 py-0.5 text-[10px] bg-slate-900/80 text-white rounded opacity-0 group-hover:opacity-100 transition"
                >
                  set cover
                </button>
              )}
              <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  type="button"
                  onClick={() => moveLeft(i)}
                  disabled={i === 0}
                  title="Move left"
                  className="px-1.5 py-0.5 text-xs bg-slate-900/80 text-white rounded disabled:opacity-30"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => moveRight(i)}
                  disabled={i === value.length - 1}
                  title="Move right"
                  className="px-1.5 py-0.5 text-xs bg-slate-900/80 text-white rounded disabled:opacity-30"
                >
                  →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500">
        Up to 10 images. JPG/PNG/WEBP/GIF, max 5MB each. First image is the cover —
        hover an image to reorder or set it as cover.
      </p>
    </div>
  );
}
