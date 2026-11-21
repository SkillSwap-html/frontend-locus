import { useEffect, useRef, useState } from "react";
import { carregarGoogleMaps } from "@/services/googleMaps";

export function GoogleStreetView({ lat, lng, className = "street-view-frame" }: { lat: number; lng: number; className?: string }) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    if (!elementRef.current) return undefined;
    setErro("");
    void carregarGoogleMaps()
      .then((google) => {
        if (!ativo || !elementRef.current) return;
        const panorama = new google.maps.StreetViewPanorama(elementRef.current, {
          position: { lat, lng },
          pov: { heading: 0, pitch: 0 },
          zoom: 1,
          visible: true,
          addressControl: true,
          fullscreenControl: true,
          linksControl: true,
          motionTrackingControl: false,
        });
        const listener = panorama.addListener("status_changed", () => {
          const status = panorama.getStatus?.();
          if (status && status !== google.maps.StreetViewStatus?.OK && ativo) {
            setErro("O Google não encontrou uma panorâmica disponível exatamente neste ponto.");
          }
        });
        return listener;
      })
      .catch((error: unknown) => {
        if (ativo) setErro(error instanceof Error ? error.message : "O Street View não pôde ser carregado.");
      });
    return () => {
      ativo = false;
    };
  }, [lat, lng]);

  return (
    <div className={`${className} street-view-google`}>
      <div ref={elementRef} className="street-view-google-canvas" />
      {erro && <div className="street-view-error">{erro}</div>}
    </div>
  );
}
