"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { ImagePlus, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

const allowedLogoTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const maxLogoBytes = 2 * 1024 * 1024;

function formatFileSize(bytes: number) {
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes.toFixed(megabytes >= 1 ? 1 : 2)}MB`;
}

export function LogoDropInput() {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function chooseFile(file: File | null) {
    setError(null);
    if (!file) return;

    if (!allowedLogoTypes.has(file.type)) {
      setFileName(null);
      setError("Use a PNG, JPG, WebP, or SVG logo.");
      return;
    }

    if (file.size > maxLogoBytes) {
      setFileName(null);
      setError(`Logo must be ${formatFileSize(maxLogoBytes)} or smaller.`);
      return;
    }

    if (inputRef.current) {
      const files = new DataTransfer();
      files.items.add(file);
      inputRef.current.files = files.files;
    }

    setFileName(file.name);
    window.setTimeout(() => inputRef.current?.form?.requestSubmit(), 0);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files.item(0));
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center transition hover:border-slate-400 hover:bg-white",
          dragging && "border-emerald-500 bg-emerald-50"
        )}
      >
        <span className="rounded-full bg-white p-3 text-slate-500 shadow-sm ring-1 ring-slate-200">
          {fileName ? <ImagePlus className="h-5 w-5" /> : <UploadCloud className="h-5 w-5" />}
        </span>
        <span className="mt-3 text-sm font-semibold text-slate-950">
          {fileName ? fileName : "Drop logo here"}
        </span>
        <span className="mt-1 text-sm leading-5 text-slate-500">
          PNG, JPG, WebP, or SVG. Max 2MB. Click to browse.
        </span>
      </label>
      <input
        ref={inputRef}
        id={inputId}
        name="logo"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="sr-only"
        onChange={(event) => chooseFile(event.currentTarget.files?.item(0) ?? null)}
      />
      {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
    </div>
  );
}
