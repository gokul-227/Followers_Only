"use client";
/* Private authenticated media must not enter shared image caches. */
/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import type { Attachment } from "@/lib/types";
export function MediaAttachment({ media }: { media: Attachment }) {
  const modal = useRef<HTMLDialogElement>(null);
  const [expanded, setExpanded] = useState(false);
  const url = "/api/media/" + media.id;
  if (media.mime.startsWith("video"))
    return (
      <video controls preload="metadata" src={url} aria-label="Creator video" />
    );
  return (
    <>
      <button
        type="button"
        className="media-preview"
        aria-label="Open creator image"
        onClick={() => {
          setExpanded(true);
          modal.current?.showModal();
        }}
      >
        <img alt="Creator attachment" src={url} loading="lazy" />
      </button>
      <dialog
        ref={modal}
        className="media-viewer"
        aria-label="Creator image viewer"
        onClose={() => setExpanded(false)}
      >
        <button
          type="button"
          className="close-viewer"
          onClick={() => modal.current?.close()}
        >
          Close image
        </button>
        {expanded && <img alt="Creator attachment, full view" src={url} />}
      </dialog>
    </>
  );
}
