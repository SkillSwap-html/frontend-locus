import { useEffect, useRef, useState } from "react";
import { carregarGoogleMaps } from "@/services/googleMaps";

export function GoogleStreetView({
  lat,
  lng,
  className = "street-view-frame",
  imagemUrl,
}: {
  lat: number;
  lng: number;
  className?: string;
  imagemUrl?: string | undefined;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [erro, setErro] = useState("");
  const [mostrarImagem, setMostrarImagem] = useState(false);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    if (!elementRef.current) return undefined;
    setErro("");
    setMostrarImagem(false);
    setCarregando(true);
    void carregarGoogleMaps()
      .then((google) => {
        if (!ativo || !elementRef.current) return;
        const panoramaEncontrado = (status: string | undefined) =>
          status === "OK" || status === google.maps.StreetViewStatus?.OK;
        const criarPanorama = (position: { lat: number; lng: number }) => {
          if (!ativo || !elementRef.current) return;
          const panorama = new google.maps.StreetViewPanorama(elementRef.current, {
            position,
            pov: { heading: 0, pitch: 0 },
            zoom: 1,
            visible: true,
            addressControl: false,
            fullscreenControl: true,
            linksControl: false,
            motionTrackingControl: false,
          });
          panorama.addListener("status_changed", () => {
            const status = panorama.getStatus?.();
            if (!ativo) return;
            setCarregando(false);
            if (status && !panoramaEncontrado(status)) {
              setErro("O Google não encontrou uma panorâmica próxima deste ponto.");
              setMostrarImagem(Boolean(imagemUrl));
            }
          });
        };
        const procurarPanorama = (raios: number[], indice = 0) => {
          if (!ativo) return;
          const raio = raios[indice];
          if (!raio) {
            setCarregando(false);
            setErro("O Google não encontrou uma panorâmica pública próxima deste ponto.");
            setMostrarImagem(Boolean(imagemUrl));
            return;
          }
          // O ponto do Places pode ficar dentro de uma atração. Tentamos
          // primeiro perto do endereço e ampliamos somente se necessário,
          // sempre usando a posição retornada pelo Street View.
          new google.maps.StreetViewService().getPanorama(
            { location: { lat, lng }, radius: raio, source: "outdoor" },
            (data, status) => {
              if (!ativo) return;
              const position = data?.location?.latLng;
              if (panoramaEncontrado(status) && position) {
                criarPanorama(position);
                return;
              }
              procurarPanorama(raios, indice + 1);
            },
          );
        };
        procurarPanorama([5000, 15000, 30000]);
      })
      .catch((error: unknown) => {
        if (ativo) {
          setCarregando(false);
          setErro(error instanceof Error ? error.message : "O Street View não pôde ser carregado.");
          setMostrarImagem(Boolean(imagemUrl));
        }
      });
    return () => {
      ativo = false;
    };
  }, [lat, lng, imagemUrl]);

  return (
    <div className={`${className} street-view-google`}>
      <div ref={elementRef} className={`street-view-google-canvas ${mostrarImagem ? "is-hidden" : ""}`} />
      {mostrarImagem && imagemUrl ? (
        <img
          className="street-view-google-image"
          src={imagemUrl}
          alt="Imagem do Google Street View"
          onError={() => {
            setMostrarImagem(false);
            setErro("A imagem do Street View não pôde ser carregada.");
          }}
        />
      ) : null}
      {carregando && <div className="street-view-loading">Carregando a panorâmica mais próxima deste local...</div>}
      {erro && !carregando && !mostrarImagem && <div className="street-view-error">{erro}</div>}
    </div>
  );
}
