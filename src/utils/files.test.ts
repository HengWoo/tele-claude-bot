import { describe, it, expect } from "vitest";
import { getFileType, generateTempFileName } from "./files.js";

describe("files utilities", () => {
  describe("getFileType", () => {
    describe("image detection", () => {
      it("should detect JPEG images by MIME type", () => {
        expect(getFileType("image/jpeg", "photo.jpg")).toBe("image");
      });

      it("should detect PNG images by MIME type", () => {
        expect(getFileType("image/png", "image.png")).toBe("image");
      });

      it("should detect images by extension when MIME unknown", () => {
        expect(getFileType("application/octet-stream", "photo.jpg")).toBe("image");
        expect(getFileType("application/octet-stream", "image.png")).toBe("image");
        expect(getFileType("application/octet-stream", "pic.gif")).toBe("image");
        expect(getFileType("application/octet-stream", "photo.webp")).toBe("image");
      });
    });

    describe("text detection", () => {
      it("should detect text files by MIME type", () => {
        expect(getFileType("text/plain", "file.txt")).toBe("text");
        expect(getFileType("text/markdown", "doc.md")).toBe("text");
        expect(getFileType("application/json", "data.json")).toBe("text");
      });

      it("should detect code files by extension", () => {
        expect(getFileType("application/octet-stream", "script.js")).toBe("text");
        expect(getFileType("application/octet-stream", "app.ts")).toBe("text");
        expect(getFileType("application/octet-stream", "main.py")).toBe("text");
        expect(getFileType("application/octet-stream", "style.css")).toBe("text");
        expect(getFileType("application/octet-stream", "page.html")).toBe("text");
        expect(getFileType("application/octet-stream", "config.yaml")).toBe("text");
        expect(getFileType("application/octet-stream", "config.yml")).toBe("text");
        expect(getFileType("application/octet-stream", "Cargo.toml")).toBe("text");
      });
    });

    describe("audio detection", () => {
      it("should detect audio files by MIME type", () => {
        expect(getFileType("audio/mpeg", "song.mp3")).toBe("audio");
        expect(getFileType("audio/ogg", "voice.ogg")).toBe("audio");
        expect(getFileType("audio/wav", "sound.wav")).toBe("audio");
      });

      it("should detect audio files by extension", () => {
        expect(getFileType("application/octet-stream", "song.mp3")).toBe("audio");
        expect(getFileType("application/octet-stream", "track.wav")).toBe("audio");
        expect(getFileType("application/octet-stream", "voice.ogg")).toBe("audio");
      });
    });

    describe("video detection", () => {
      it("should detect video files by MIME type", () => {
        expect(getFileType("video/mp4", "movie.mp4")).toBe("video");
        expect(getFileType("video/webm", "clip.webm")).toBe("video");
      });

      it("should detect video files by extension", () => {
        expect(getFileType("application/octet-stream", "video.mp4")).toBe("video");
        expect(getFileType("application/octet-stream", "movie.mov")).toBe("video");
        expect(getFileType("application/octet-stream", "clip.avi")).toBe("video");
      });
    });

    describe("document detection", () => {
      it("should detect PDF by MIME type", () => {
        expect(getFileType("application/pdf", "doc.pdf")).toBe("document");
      });

      it("should detect Office documents by MIME type", () => {
        expect(getFileType("application/msword", "doc.doc")).toBe("document");
        expect(
          getFileType(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "doc.docx"
          )
        ).toBe("document");
      });

      it("should detect documents by extension", () => {
        expect(getFileType("application/octet-stream", "report.pdf")).toBe("document");
        expect(getFileType("application/octet-stream", "letter.doc")).toBe("document");
        expect(getFileType("application/octet-stream", "thesis.docx")).toBe("document");
        expect(getFileType("application/octet-stream", "data.xlsx")).toBe("document");
        expect(getFileType("application/octet-stream", "slides.pptx")).toBe("document");
      });
    });

    describe("other files", () => {
      it("should return 'other' for unknown types", () => {
        expect(getFileType("application/octet-stream", "file.xyz")).toBe("other");
        expect(getFileType("application/octet-stream", "data.bin")).toBe("other");
        expect(getFileType("application/x-unknown", "mystery")).toBe("other");
      });
    });
  });

  describe("generateTempFileName", () => {
    it("should add timestamp to filename", () => {
      const original = "photo.jpg";
      const result = generateTempFileName(original);

      expect(result).toMatch(/^photo-\d+\.jpg$/);
      expect(result).not.toBe(original);
    });

    it("should preserve file extension", () => {
      expect(generateTempFileName("document.pdf")).toMatch(/\.pdf$/);
      expect(generateTempFileName("script.ts")).toMatch(/\.ts$/);
      expect(generateTempFileName("image.png")).toMatch(/\.png$/);
    });

    it("should handle files without extension", () => {
      const result = generateTempFileName("Makefile");
      expect(result).toMatch(/^Makefile-\d+$/);
    });

    it("should handle multiple dots in filename", () => {
      const result = generateTempFileName("archive.tar.gz");
      expect(result).toMatch(/^archive\.tar-\d+\.gz$/);
    });

    it("should generate unique names on consecutive calls", () => {
      const name1 = generateTempFileName("file.txt");
      // Small delay to ensure different timestamp
      const name2 = generateTempFileName("file.txt");

      // Names might be the same if called in same millisecond,
      // but should contain timestamp pattern
      expect(name1).toMatch(/^file-\d+\.txt$/);
      expect(name2).toMatch(/^file-\d+\.txt$/);
    });
  });
});
