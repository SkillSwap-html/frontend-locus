import type { Lugar } from "@/types";
import { GoogleMapCanvas } from "./GoogleMapCanvas";

export function MapPreview({ lugares }: { lugares: Lugar[] }) {
  return <GoogleMapCanvas lugares={lugares} />;
}
