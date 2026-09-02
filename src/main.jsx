import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import {
  ArrowRight,
  ArrowUpDown,
  Check,
  LocateFixed,
  MapPin,
  Search,
  X,
} from "lucide-react";
import {
  mapCenter,
  mapZoom,
  tamilNaduLocations,
} from "./data/tamilNaduLocations";
import "./styles.css";

const categories = ["All", "Cities", "Tourist Places", "Beaches", "Temples"];
const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const travelModes = [
  { value: "DRIVING", label: "Driving", icon: "🚗" },
  { value: "WALKING", label: "Walking", icon: "🚶" },
  { value: "BICYCLING", label: "Cycling", icon: "🚲" },
  { value: "TRANSIT", label: "Transit", icon: "🚌" },
];
const normalizeSearchValue = (value) => value.toLowerCase().replace(/\s+/g, "");

if (typeof window !== "undefined" && googleMapsApiKey) {
  setOptions({ key: googleMapsApiKey, v: "weekly" });
}

function markerSvg(location, selected = false) {
  const color = location.type === "City" ? "#dc7654" : "#245644";
  const scale = selected ? 1.18 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36"><g transform="translate(14 15) scale(${scale}) rotate(45)"><path d="M0-12a12 12 0 1 1 0 24C-6 12-12 6-12 0A12 12 0 0 1 0-12Z" fill="${color}" stroke="white" stroke-width="3"/><circle cx="0" cy="0" r="3" fill="white"/></g></svg>`;
}

function createMarkerContent(location, selected = false) {
  const image = document.createElement("img");
  image.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(markerSvg(location, selected))}`;
  image.width = 28;
  image.height = 36;
  image.alt = `${location.name} marker`;
  return image;
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return "Distance unavailable";
  return `${Math.round(distanceMeters / 1000)} km`;
}

function formatDuration(durationMillis) {
  if (!Number.isFinite(durationMillis)) return "Duration unavailable";
  const totalMinutes = Math.max(1, Math.round(durationMillis / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours
    ? `${hours} hr${hours === 1 ? "" : "s"} ${minutes ? `${minutes} min` : ""}`.trim()
    : `${minutes} min`;
}

function routeDistance(route) {
  return (
    route.localizedValues?.distance?.text ||
    formatDistance(route.distanceMeters)
  );
}

function routeDuration(route) {
  return (
    route.localizedValues?.duration?.text ||
    formatDuration(route.durationMillis)
  );
}

function routeMarkerContent(label, color) {
  const marker = document.createElement("div");
  marker.className = "route-marker";
  marker.style.backgroundColor = color;
  marker.textContent = label;
  return marker;
}

function GoogleMapView({
  locations,
  selectedLocation,
  onSelect,
  onReset,
  onReady,
  onError,
  onRouteError,
  routeRequest,
  selectedRouteIndex,
  onRouteResult,
  onRouteSelected,
  onRouteLoading,
  mapType,
  onMapTypeChange,
  trafficEnabled,
  onTrafficChange,
}) {
  const mapElement = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const infoWindowRef = useRef(null);
  const markerRefClass = useRef(null);
  const routesRef = useRef([]);
  const routePolylinesRef = useRef([]);
  const routeMarkersRef = useRef([]);
  const trafficLayerRef = useRef(null);
  const selectedLocationId = selectedLocation?.id;
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!googleMapsApiKey) {
      onError(
        "Add VITE_GOOGLE_MAPS_API_KEY to your .env file to load the Google map.",
      );
      return undefined;
    }
    let cancelled = false;
    Promise.all([importLibrary("maps"), importLibrary("marker")])
      .then(([{ Map }, { AdvancedMarkerElement }]) => {
        if (cancelled || !mapElement.current) return;
        const googleMap = new Map(mapElement.current, {
          center: { lat: mapCenter[0], lng: mapCenter[1] },
          zoom: mapZoom,
          minZoom: 6,
          maxZoom: 16,
          mapId: "DEMO_MAP_ID",
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
          styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
        });
        mapRef.current = googleMap;
        infoWindowRef.current = new window.google.maps.InfoWindow();
        markerRefClass.current = AdvancedMarkerElement;
        setMapReady(true);
        onReady(googleMap);
      })
      .catch(() =>
        onError(
          "Google Maps could not load. Check your API key, Maps JavaScript API access, and billing settings.",
        ),
      );
    return () => {
      cancelled = true;
    };
  }, [onError, onReady]);

  useEffect(() => {
    routePolylinesRef.current.forEach(({ polyline }) => polyline.setMap(null));
    routePolylinesRef.current = [];
    routeMarkersRef.current.forEach((marker) => {
      marker.map = null;
    });
    routeMarkersRef.current = [];
    if (!routeRequest || !mapRef.current || !mapReady) return;
    let cancelled = false;
    onRouteLoading();
    routePolylinesRef.current.forEach(({ polyline }) => polyline.setMap(null));
    routePolylinesRef.current = [];
    routeMarkersRef.current.forEach((marker) => {
      marker.map = null;
    });
    routeMarkersRef.current = [];

    const calculateRoute = async () => {
      const { Route } = await window.google.maps.importLibrary("routes");
      return Route.computeRoutes({
        origin: {
          lat: routeRequest.origin.latitude,
          lng: routeRequest.origin.longitude,
        },
        destination: {
          lat: routeRequest.destination.latitude,
          lng: routeRequest.destination.longitude,
        },
        travelMode: routeRequest.travelMode,
        computeAlternativeRoutes: true,
        routeModifiers:
          routeRequest.travelMode === "DRIVING"
            ? {
                avoidTolls: routeRequest.avoidTolls,
                avoidHighways: routeRequest.avoidHighways,
              }
            : undefined,
        fields: [
          "path",
          "viewport",
          "distanceMeters",
          "durationMillis",
          "localizedValues",
          "routeLabels",
        ],
      });
    };
    calculateRoute()
      .then(({ routes }) => {
        if (cancelled) return;
        if (!routes?.length)
          throw new Error("No route found between these locations.");
        const routeSummaries = routes.map((route, index) => ({
          index,
          distance: routeDistance(route),
          duration: routeDuration(route),
          distanceMeters: route.distanceMeters,
          durationMillis: route.durationMillis,
          labels: route.routeLabels || [],
          localizedValues: route.localizedValues || {},
        }));
        routesRef.current = routes;
        routes.forEach((route, index) => {
          route.createPolylines().forEach((polyline) => {
            polyline.setOptions({
              strokeColor: index === 0 ? "#245644" : "#80988a",
              strokeOpacity: index === 0 ? 0.9 : 0.35,
              strokeWeight: index === 0 ? 6 : 4,
              zIndex: index === 0 ? 2 : 1,
              clickable: true,
            });
            polyline.setMap(mapRef.current);
            polyline.addListener("click", () => onRouteSelected(index));
            routePolylinesRef.current.push({ polyline, routeIndex: index });
          });
        });
        const chosenRoute = routes[0];
        if (chosenRoute.viewport)
          mapRef.current.fitBounds(chosenRoute.viewport);
        const originMarker = new markerRefClass.current({
          map: mapRef.current,
          position: {
            lat: routeRequest.origin.latitude,
            lng: routeRequest.origin.longitude,
          },
          title: `Start: ${routeRequest.origin.name}`,
          content: routeMarkerContent("A", "#245644"),
        });
        const destinationMarker = new markerRefClass.current({
          map: mapRef.current,
          position: {
            lat: routeRequest.destination.latitude,
            lng: routeRequest.destination.longitude,
          },
          title: `End: ${routeRequest.destination.name}`,
          content: routeMarkerContent("B", "#dc7654"),
        });
        routeMarkersRef.current = [originMarker, destinationMarker];
        onRouteResult(routeSummaries);
      })
      .catch((error) => {
        if (!cancelled)
          onRouteError(
            error.message?.includes("No route")
              ? "No route found"
              : error.message || "Google could not calculate this route.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [
    mapReady,
    onRouteError,
    onRouteLoading,
    onRouteResult,
    onRouteSelected,
    routeRequest,
  ]);

  useEffect(() => {
    routePolylinesRef.current.forEach(({ polyline, routeIndex }) => {
      const selected = routeIndex === selectedRouteIndex;
      polyline.setOptions({
        strokeColor: selected ? "#245644" : "#80988a",
        strokeOpacity: selected ? 0.9 : 0.35,
        strokeWeight: selected ? 6 : 4,
        zIndex: selected ? 2 : 1,
      });
    });
  }, [selectedRouteIndex]);

  useEffect(() => {
    const googleMap = mapRef.current;
    if (!googleMap || !markerRefClass.current || !mapReady) return;
    const previousMarkers = markersRef.current;
    const createdMarkers = new Map();
    previousMarkers.forEach((marker) => {
      marker.map = null;
    });
    previousMarkers.clear();
    markersRef.current = createdMarkers;
    locations.forEach((location) => {
      const marker = new markerRefClass.current({
        map: googleMap,
        position: { lat: location.latitude, lng: location.longitude },
        title: location.name,
        content: createMarkerContent(location),
      });
      marker.addEventListener("click", () => onSelect(location));
      markersRef.current.set(location.id, marker);
      createdMarkers.set(location.id, marker);
    });
    return () => {
      createdMarkers.forEach((marker) => {
        marker.map = null;
      });
      createdMarkers.clear();
    };
  }, [locations, mapReady, onSelect]);

  useEffect(() => {
    markersRef.current.forEach((marker, locationId) => {
      const location = tamilNaduLocations.find(
        (item) => item.id === locationId,
      );
      if (location)
        marker.content = createMarkerContent(
          location,
          selectedLocationId === location.id,
        );
    });
  }, [mapReady, selectedLocationId]);

  useEffect(() => {
    const googleMap = mapRef.current;
    if (!googleMap || !selectedLocation) return;
    const position = {
      lat: selectedLocation.latitude,
      lng: selectedLocation.longitude,
    };
    googleMap.panTo(position);
    googleMap.setZoom(selectedLocation.type === "City" ? 9 : 12);
    const marker = markersRef.current.get(selectedLocation.id);
    infoWindowRef.current?.setContent(
      `<strong>${selectedLocation.name}</strong><br><small>${selectedLocation.type} · ${selectedLocation.district}</small>`,
    );
    if (marker) infoWindowRef.current?.open({ map: googleMap, anchor: marker });
  }, [selectedLocation]);

  useEffect(() => {
    if (mapRef.current) mapRef.current.setMapTypeId(mapType);
  }, [mapType]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (!trafficEnabled) {
      trafficLayerRef.current?.setMap(null);
      return;
    }
    try {
      if (!trafficLayerRef.current)
        trafficLayerRef.current = new window.google.maps.TrafficLayer();
      trafficLayerRef.current.setMap(mapRef.current);
    } catch {
      onError("Live traffic is unavailable for this map configuration.");
      onTrafficChange(false);
    }
  }, [onError, onTrafficChange, trafficEnabled]);

  const resetMap = () => {
    if (mapRef.current) {
      mapRef.current.panTo({ lat: mapCenter[0], lng: mapCenter[1] });
      mapRef.current.setZoom(mapZoom);
    }
    infoWindowRef.current?.close();
    onReset();
  };

  const locateUser = () => {
    if (!navigator.geolocation || !mapRef.current) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        mapRef.current.panTo({ lat: coords.latitude, lng: coords.longitude });
        mapRef.current.setZoom(13);
      },
      () =>
        onError(
          "Your current location could not be accessed. Check browser location permissions.",
        ),
    );
  };

  return (
    <>
      <div ref={mapElement} className="map" />
      <div className="map-actions">
        <div className="layer-control">
          <button
            className="map-control"
            onClick={() =>
              onMapTypeChange(
                mapType === "roadmap"
                  ? "satellite"
                  : mapType === "satellite"
                    ? "terrain"
                    : "roadmap",
              )
            }
            title="Change map layer"
          >
            <span className="layer-swatch" />{" "}
            <span>
              {mapType === "roadmap"
                ? "Default"
                : mapType[0].toUpperCase() + mapType.slice(1)}
            </span>
          </button>
          <div className="layer-menu">
            {[
              ["roadmap", "Default"],
              ["satellite", "Satellite"],
              ["terrain", "Terrain"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={mapType === value ? "selected" : ""}
                onClick={() => onMapTypeChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          className={`map-control traffic-control ${trafficEnabled ? "active" : ""}`}
          onClick={() => onTrafficChange(!trafficEnabled)}
          title="Toggle live traffic"
        >
          <span className="traffic-dot" /> Traffic
        </button>
        <button
          className="map-control"
          onClick={resetMap}
          title="Reset Tamil Nadu view"
        >
          <LocateFixed size={16} />
          <span>Tamil Nadu</span>
        </button>
        <button
          className="map-control icon-control"
          onClick={locateUser}
          title="Use current location"
          aria-label="Use current location"
        >
          <MapPin size={16} />
        </button>
      </div>
    </>
  );
}

function App() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [directionsMode, setDirectionsMode] = useState(false);
  const [origin, setOrigin] = useState("");
  const [travelMode, setTravelMode] = useState("DRIVING");
  const [avoidTolls, setAvoidTolls] = useState(false);
  const [avoidHighways, setAvoidHighways] = useState(false);
  const [mapType, setMapType] = useState("roadmap");
  const [trafficEnabled, setTrafficEnabled] = useState(false);
  const [routeRequest, setRouteRequest] = useState(null);
  const [routeState, setRouteState] = useState({
    distance: "",
    duration: "",
    routes: [],
    selectedRoute: null,
    loading: false,
    error: "",
  });
  const [mapError, setMapError] = useState("");
  const [recentSearches, setRecentSearches] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("tamil-nadu-recent") || "[]");
    } catch {
      return [];
    }
  });
  const [savedPlaces, setSavedPlaces] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("tamil-nadu-saved") || "{}");
    } catch {
      return {};
    }
  });
  const filteredLocations = useMemo(
    () =>
      activeCategory === "All"
        ? tamilNaduLocations
        : tamilNaduLocations.filter(
            (location) => location.category === activeCategory,
          ),
    [activeCategory],
  );
  const normalizedQuery = normalizeSearchValue(query.trim());
  const suggestions = normalizedQuery
    ? tamilNaduLocations
        .filter((location) =>
          [
            location.name,
            location.description,
            location.category,
            location.type,
            location.district,
          ].some((field) =>
            normalizeSearchValue(field).includes(normalizedQuery),
          ),
        )
        .slice(0, 6)
    : [];

  const selectLocation = (location) => {
    setQuery(location.name);
    setSelectedLocation(location);
    setActiveCategory("All");
    setIsSearchOpen(false);
    setHighlightedIndex(0);
    setDirectionsMode(false);
    setRecentSearches((items) =>
      [location, ...items.filter((item) => item.id !== location.id)].slice(
        0,
        6,
      ),
    );
  };
  const selectMarker = useCallback((location) => {
    setQuery(location.name);
    setSelectedLocation(location);
    setIsSearchOpen(false);
    setDirectionsMode(false);
    setRecentSearches((items) =>
      [location, ...items.filter((item) => item.id !== location.id)].slice(
        0,
        6,
      ),
    );
  }, []);
  const clearSearch = () => {
    setQuery("");
    setIsSearchOpen(false);
    setHighlightedIndex(0);
  };
  const handleSearchKeyDown = (event) => {
    if (event.key === "Escape") {
      setIsSearchOpen(false);
      return;
    }
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setIsSearchOpen(true);
      setHighlightedIndex((index) => (index + 1) % suggestions.length);
    }
    if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setIsSearchOpen(true);
      setHighlightedIndex(
        (index) => (index - 1 + suggestions.length) % suggestions.length,
      );
    }
    if (event.key === "Enter" && suggestions.length) {
      event.preventDefault();
      selectLocation(suggestions[highlightedIndex] || suggestions[0]);
    }
  };
  useEffect(() => {
    localStorage.setItem("tamil-nadu-recent", JSON.stringify(recentSearches));
  }, [recentSearches]);
  useEffect(() => {
    localStorage.setItem("tamil-nadu-saved", JSON.stringify(savedPlaces));
  }, [savedPlaces]);
  const resetApp = useCallback(() => {
    setSelectedLocation(null);
    setQuery("");
    setIsSearchOpen(false);
    setHighlightedIndex(0);
    setDirectionsMode(false);
    setOrigin("");
    setRouteRequest(null);
    setRouteState({
      distance: "",
      duration: "",
      routes: [],
      selectedRoute: null,
      loading: false,
      error: "",
    });
  }, []);
  const handleMapError = useCallback((message) => setMapError(message), []);
  const handleMapReady = useCallback(() => setMapError(""), []);
  const swapDirections = () => {
    if (!selectedLocation || !origin) return;
    const destination = tamilNaduLocations.find(
      (location) => location.name === origin,
    );
    setOrigin(selectedLocation.name);
    setSelectedLocation(destination || selectedLocation);
    setRouteRequest(null);
  };
  const calculateRoute = () => {
    const originLocation = tamilNaduLocations.find(
      (location) => location.name === origin,
    );
    if (
      !originLocation ||
      !selectedLocation ||
      originLocation.id === selectedLocation.id
    ) {
      setRouteState((state) => ({
        ...state,
        error: "Choose two different Tamil Nadu locations.",
      }));
      return;
    }
    setRouteState({
      distance: "",
      duration: "",
      routes: [],
      selectedRoute: null,
      loading: true,
      error: "",
    });
    setRouteRequest({
      origin: originLocation,
      destination: selectedLocation,
      travelMode,
      avoidTolls,
      avoidHighways,
    });
  };
  const changeRouteSetting = (setting, value) => {
    if (setting === "travelMode") setTravelMode(value);
    if (setting === "avoidTolls") setAvoidTolls(value);
    if (setting === "avoidHighways") setAvoidHighways(value);
    if (routeRequest) {
      const next = { ...routeRequest, [setting]: value };
      setRouteState((state) => ({ ...state, loading: true, error: "" }));
      setRouteRequest(next);
    }
  };
  const handleRouteResult = useCallback((routes) => {
    const selected = routes[0];
    setRouteState({
      distance: selected.distance,
      duration: selected.duration,
      routes,
      selectedRoute: selected,
      loading: false,
      error: "",
    });
  }, []);
  const handleRouteSelected = useCallback(
    (index) =>
      setRouteState((state) => ({
        ...state,
        selectedRoute: state.routes[index],
        distance: state.routes[index]?.distance || state.distance,
        duration: state.routes[index]?.duration || state.duration,
      })),
    [],
  );
  const handleRouteLoading = useCallback(
    () => setRouteState((state) => ({ ...state, loading: true, error: "" })),
    [],
  );
  const handleRouteError = useCallback(
    (message) =>
      setRouteState((state) => ({ ...state, loading: false, error: message })),
    [],
  );
  const clearRoute = () => {
    setRouteRequest(null);
    setRouteState({
      distance: "",
      duration: "",
      routes: [],
      selectedRoute: null,
      loading: false,
      error: "",
    });
  };
  const savePlace = (slot) => {
    if (selectedLocation)
      setSavedPlaces((places) => ({ ...places, [slot]: selectedLocation }));
  };

  return (
    <main className="app-shell">
      <section
        className="map-stage"
        aria-label="Interactive Google map of Tamil Nadu"
      >
        <GoogleMapView
          locations={filteredLocations}
          selectedLocation={selectedLocation}
          onSelect={selectMarker}
          onReset={resetApp}
          onReady={handleMapReady}
          onError={handleMapError}
          onRouteError={handleRouteError}
          routeRequest={routeRequest}
          selectedRouteIndex={routeState.selectedRoute?.index || 0}
          onRouteResult={handleRouteResult}
          onRouteSelected={handleRouteSelected}
          onRouteLoading={handleRouteLoading}
          mapType={mapType}
          onMapTypeChange={setMapType}
          trafficEnabled={trafficEnabled}
          onTrafficChange={setTrafficEnabled}
        />
        {mapError && (
          <div className="map-error" role="alert">
            <MapPin size={21} />
            <strong>Map unavailable</strong>
            <p>{mapError}</p>
          </div>
        )}
        <div className="top-overlay">
          <div className="brand-lockup">
            <span className="brand-mark">
              <MapPin size={18} />
            </span>
            <div>
              <p>Atlas / South India</p>
              <h1>Explore Tamil Nadu</h1>
            </div>
          </div>
          <div className="search-wrap">
            <div className="search-bar">
              <Search size={19} />
              <input
                value={query}
                onFocus={() => setIsSearchOpen(true)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setIsSearchOpen(true);
                  setHighlightedIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search cities and places"
                aria-label="Search Tamil Nadu locations"
                aria-expanded={isSearchOpen}
              />
              {query && (
                <button
                  className="clear-button"
                  onClick={clearSearch}
                  aria-label="Clear search"
                >
                  <X size={17} />
                </button>
              )}
            </div>
            {isSearchOpen && normalizedQuery && (
              <div className="suggestions" role="listbox">
                {suggestions.length ? (
                  suggestions.map((location, index) => (
                    <button
                      key={location.id}
                      className={
                        highlightedIndex === index ? "highlighted" : ""
                      }
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onClick={() => selectLocation(location)}
                      role="option"
                      aria-selected={highlightedIndex === index}
                    >
                      <span
                        className={
                          location.type === "City"
                            ? "suggestion-city"
                            : "suggestion-place"
                        }
                      >
                        {location.type === "City" ? "●" : "◆"}
                      </span>
                      <span>
                        <strong>{location.name}</strong>
                        <small>
                          {location.type} · {location.district}
                        </small>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="empty-search">No places found</div>
                )}
              </div>
            )}
            {isSearchOpen &&
              !normalizedQuery &&
              (recentSearches.length > 0 ||
                Object.keys(savedPlaces).length > 0) && (
                <div className="suggestions recent-panel">
                  <div className="recent-heading">Saved & recent</div>
                  {["Home", "Work"].map(
                    (slot) =>
                      savedPlaces[slot] && (
                        <button
                          key={slot}
                          onClick={() => selectLocation(savedPlaces[slot])}
                        >
                          <span className="suggestion-place">◆</span>
                          <span>
                            <strong>{slot}</strong>
                            <small>{savedPlaces[slot].name}</small>
                          </span>
                        </button>
                      ),
                  )}
                  {recentSearches.map((location) => (
                    <button
                      key={location.id}
                      onClick={() => selectLocation(location)}
                    >
                      <span
                        className={
                          location.type === "City"
                            ? "suggestion-city"
                            : "suggestion-place"
                        }
                      >
                        {location.type === "City" ? "●" : "◆"}
                      </span>
                      <span>
                        <strong>{location.name}</strong>
                        <small>Recent · {location.district}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
          </div>
          <div
            className="category-row"
            role="tablist"
            aria-label="Filter map locations"
          >
            {categories.map((category) => (
              <button
                key={category}
                className={activeCategory === category ? "active" : ""}
                onClick={() => setActiveCategory(category)}
                role="tab"
                aria-selected={activeCategory === category}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
        <div className="map-legend">
          <span>
            <i className="legend-city" /> Cities
          </span>
          <span>
            <i className="legend-place" /> Places
          </span>
        </div>
        {selectedLocation && !directionsMode && (
          <aside className="place-card">
            <button
              className="card-close"
              onClick={() => setSelectedLocation(null)}
              aria-label="Close place details"
            >
              <X size={18} />
            </button>
            <div className="place-kicker">
              <span
                className={
                  selectedLocation.type === "City"
                    ? "kicker-icon city-kicker"
                    : "kicker-icon place-kicker-icon"
                }
              >
                {selectedLocation.type === "City" ? "●" : "◆"}
              </span>
              {selectedLocation.type} <span className="separator">/</span>{" "}
              {selectedLocation.category}
            </div>
            <h2>{selectedLocation.name}</h2>
            <p className="district">{selectedLocation.district}, Tamil Nadu</p>
            <p className="description">{selectedLocation.description}</p>
            <div className="save-row">
              {["Home", "Work"].map((slot) => (
                <button
                  key={slot}
                  className={
                    savedPlaces[slot]?.id === selectedLocation.id ? "saved" : ""
                  }
                  onClick={() => savePlace(slot)}
                >
                  {savedPlaces[slot]?.id === selectedLocation.id
                    ? "Saved"
                    : `Save as ${slot}`}
                </button>
              ))}
            </div>
            <button
              className="directions-button"
              onClick={() => {
                setDirectionsMode(true);
                setOrigin("");
              }}
            >
              <ArrowRight size={17} /> Directions
            </button>
          </aside>
        )}
        {selectedLocation && directionsMode && (
          <aside className="place-card directions-card">
            <button
              className="card-close"
              onClick={() => setDirectionsMode(false)}
              aria-label="Close directions"
            >
              <X size={18} />
            </button>
            <div className="place-kicker">
              DIRECTIONS <span className="separator">/</span> ROUTE PLANNER
            </div>
            <h2>Plan a journey</h2>
            <div className="mode-row">
              {travelModes.map((mode) => (
                <button
                  key={mode.value}
                  className={travelMode === mode.value ? "active" : ""}
                  onClick={() => changeRouteSetting("travelMode", mode.value)}
                >
                  {mode.icon} {mode.label}
                </button>
              ))}
            </div>
            {travelMode === "DRIVING" && (
              <div className="option-row">
                <label>
                  <input
                    type="checkbox"
                    checked={avoidTolls}
                    onChange={(event) =>
                      changeRouteSetting("avoidTolls", event.target.checked)
                    }
                  /> Avoid tolls
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={avoidHighways}
                    onChange={(event) =>
                      changeRouteSetting("avoidHighways", event.target.checked)
                    }
                  /> Avoid highways
                </label>
              </div>
            )}
            <div className="route-field">
              <span>FROM</span>
              <select
                value={origin}
                onChange={(event) => {
                  setOrigin(event.target.value);
                  setRouteRequest(null);
                }}
                aria-label="Select starting point"
              >
                <option value="">Select starting point</option>
                {tamilNaduLocations
                  .filter((location) => location.id !== selectedLocation.id)
                  .map((location) => (
                    <option key={location.id} value={location.name}>
                      {location.name}
                    </option>
                  ))}
              </select>
            </div>
            <button
              className="swap-button"
              disabled={!origin}
              onClick={swapDirections}
              aria-label="Swap origin and destination"
            >
              <ArrowUpDown size={16} />
            </button>
            <div className="route-field">
              <span>TO</span>
              <div className="destination-field">
                {selectedLocation.name}
                <Check size={15} />
              </div>
            </div>
            {routeState.error && (
              <p className="route-error">{routeState.error}</p>
            )}
            <button
              className="directions-button"
              disabled={!origin || routeState.loading}
              onClick={calculateRoute}
            >
              <ArrowRight size={17} />{" "}
              {routeState.loading ? "Calculating route..." : "Get Directions"}
            </button>
            {routeState.routes.length > 1 && (
              <div className="alternate-routes">
                <span>ALTERNATIVE ROUTES</span>
                {routeState.routes.map((route) => (
                  <button
                    key={route.index}
                    className={
                      routeState.selectedRoute?.index === route.index
                        ? "selected"
                        : ""
                    }
                    onClick={() => handleRouteSelected(route.index)}
                  >
                    Route {route.index + 1}
                    <small>
                      {route.distance} · {route.duration}
                    </small>
                  </button>
                ))}
              </div>
            )}
            {routeState.distance && (
              <div className="route-summary">
                <strong>
                  {travelModes.find((mode) => mode.value === travelMode)?.icon}{" "}
                  {routeState.distance}
                </strong>
                <span>{routeState.duration}</span>
                <button onClick={clearRoute}>Clear route</button>
              </div>
            )}
          </aside>
        )}
        {!selectedLocation && (
          <div className="map-hint">
            <span>28 locations mapped</span>
            <span className="hint-dot" /> Pan, zoom & explore
          </div>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
