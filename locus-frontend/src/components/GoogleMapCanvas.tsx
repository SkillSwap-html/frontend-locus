import { useEffect, useRef, useState } from "react";
import type { Lugar } from "@/types";
import { carregarGoogleMaps } from "@/services/googleMaps";

export function GoogleMapCanvas({ lugares }: { lugares: Lugar[] }) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [erro, setErro] = useState("");
  const pontos = lugares
    .filter((lugar) => Number.isFinite(lugar.lat) && Number.isFinite(lugar.lng))
    .slice(0, 8);
  const chavePontos = pontos.map((ponto) => `${ponto.placeId}:${ponto.lat}:${ponto.lng}`).join("|");

  useEffect(() => {
    let ativo = true;
    if (!elementRef.current || !pontos.length) return undefined;
    setErro("");
    void carregarGoogleMaps()
      .then((google) => {
        if (!ativo || !elementRef.current) return;
        const mapa = new google.maps.Map(elementRef.current, {
          center: { lat: pontos[0]!.lat, lng: pontos[0]!.lng },
          zoom: pontos.length === 1 ? 15 : 12,
          mapTypeControl: true,
          streetViewControl: true,
          fullscreenControl: true,
        });
        const limites = new google.maps.LatLngBounds();
        pontos.forEach((ponto) => {
          const position = { lat: ponto.lat, lng: ponto.lng };
          limites.extend(position);
          new google.maps.Marker({ map: mapa, position, title: ponto.nome });
        });
        if (pontos.length > 1) mapa.fitBounds(limites);
      })
      .catch((error: unknown) => {
        if (ativo) setErro(error instanceof Error ? error.message : "O Google Maps não pôde ser carregado.");
      });
    return () => {
      ativo = false;
    };
  }, [chavePontos]);

  if (!lugares.length) return null;
  if (!pontos.length) {
    return <div className="map-preview map-preview-empty"><strong>Localização indisponível</strong><span>Confira o endereço no cartão do local.</span></div>;
  }
  return (
    <div className="map-preview" aria-label="Google Maps dos lugares encontrados">
      <div ref={elementRef} className="map-preview-frame" />
      {erro && <div className="map-preview-error">{erro}</div>}
      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${pontos[0]!.lat},${pontos[0]!.lng}`)}`} target="_blank" rel="noreferrer">
        Abrir no Google Maps
      </a>
      <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${pontos[0]!.lat},${pontos[0]!.lng}`} target="_blank" rel="noreferrer">
        Abrir no Google Street View
      </a>
    </div>
  );
}
