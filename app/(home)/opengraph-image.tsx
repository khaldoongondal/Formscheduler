import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "FormBook: qualify, book and measure every lead in one form";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const logo = await readFile(join(process.cwd(), "public", "brand", "formbook-lockup.png"));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#f5f5ed", color: "#193c35" }}>
        <div style={{ display: "flex", flexDirection: "column", padding: "36px 54px 0", height: 380 }}>
          <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: 16, borderBottom: "1px solid #cdd1c5", fontSize: 15, letterSpacing: 2 }}>
            <span>FORMBOOK</span><span>FOR CALL-BOOKING FUNNELS</span>
          </div>
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
            {/* ImageResponse needs embedded image bytes to render without a network request. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="FormBook" src={`data:image/png;base64,${logo.toString("base64")}`} width={758} height={130} />
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, backgroundColor: "#193c35", color: "#f5f5ed" }}>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: 900, padding: "22px 54px" }}>
            <div style={{ display: "flex", maxWidth: 760, fontSize: 47, lineHeight: 1.1, letterSpacing: -1.4 }}>Qualify, book and measure every lead in one form.</div>
            <div style={{ display: "flex", marginTop: 22, fontSize: 19, color: "#e1e4d5" }}>Free plan available</div>
          </div>
          <div style={{ width: 165, height: "100%", backgroundColor: "#806399" }} />
          <div style={{ width: 70, height: "100%", backgroundColor: "#acbd93" }} />
          <div style={{ width: 35, height: "100%", backgroundColor: "#d9cfe8" }} />
          <div style={{ width: 30, height: "100%", backgroundColor: "#c77962" }} />
        </div>
      </div>
    ),
    size
  );
}
