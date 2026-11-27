import { ImageResponse } from "next/og";

export const alt = "FormBook, a tool from Gondal Tech";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#ffffff"
        }}
      >
        <div style={{ width: 24, height: "100%", backgroundColor: "#2bab80" }} />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 96px"
          }}
        >
          <div style={{ fontSize: 96, fontWeight: 700, color: "#0f172a" }}>FormBook</div>
          <div style={{ marginTop: 24, fontSize: 44, color: "#334155", lineHeight: 1.25 }}>
            Qualify, book and measure every lead in one form.
          </div>
          <div style={{ marginTop: 56, fontSize: 28, color: "#2bab80" }}>A tool from Gondal Tech</div>
        </div>
      </div>
    ),
    size
  );
}
