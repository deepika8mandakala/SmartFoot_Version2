(function () {
  "use strict";

  // ─── Constants ────────────────────────────────────────────────────────────────
  const NOMINATIM_URL        = "https://nominatim.openstreetmap.org/search";
  const NOMINATIM_REVERSE_URL= "https://nominatim.openstreetmap.org/reverse";
  const OSRM_URL             = "https://router.project-osrm.org/route/v1/foot";
  const COLORS               = ["#0b7a2a", "#1a73e8", "#a142f4", "#f29900", "#d93025"];
  const WALKING_SPEED_KMH    = 4.5;
  const ARRIVAL_THRESHOLD_METERS = 20;

  const RADIUS_SCALE_FACTORS = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.35];
  const PERIMETER_FACTOR = 2 + 3 * Math.SQRT2;
  const ROAD_OVERHEAD_FACTOR = 3.0;
  const LOOP_ANGLE_OFFSETS   = [0, 30, 60];

  // ─── App State ─────────────────────────────────────────────────��──────────────
  const state = {
    map: null,
    markers:    L.layerGroup(),
    routeLayer: L.layerGroup(),
    userLayer:  L.layerGroup(),
    routes: [],
    selectedRouteIndex: -1,
    selectedPlace: { from: null, to: null },
    searchControllers: { from: null, to: null },
    watchPositionId: null,
    navigationRoute: null,
    navigationDestination: null,
    navigationMarker: null,
    currentPosition: null,
    activeCityBias: null,
    mapillaryTimer: null,
    mapillaryStep: 0,
    mapillaryPoints: [],
    voiceEnabled: true,
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  // ─── Bootstrap ────────────────────────────────────────────────────────────────
  function init() {
    cacheElements();
    initMap();
    bindEvents();
    hydrateCurrentLocation(false);
    updateStatus("🌍 Map ready. Search for a location or detect your current position.");
  }

  function cacheElements() {
    [
      "from", "to", "fromSuggestions", "toSuggestions",
      "currentLocationBtn", "findRoutesBtn", "findWalksBtn",
      "generateWalksBtn", "durationControls", "walkDuration",
      "routesList", "status", "navigation-panel",
      "current-instruction", "current-distance",
      "next-instruction", "next-distance",
      "voice-guidance", "closeNavigationBtn", "stopNavigationBtn",
      "street-view", "mapillaryFrame", "mapillaryExternalLink",
      "streetViewEmpty", "start-tour", "stop-tour", "tour-speed",
    ].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function initMap() {
    // Start at world view (zoom 3) - no hardcoded city
    state.map = L.map("map", { zoomControl: true, preferCanvas: true })
      .setView([20, 0], 3);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(state.map);

    state.markers.addTo(state.map);
    state.routeLayer.addTo(state.map);
    state.userLayer.addTo(state.map);
  }

  function bindEvents() {
    setupAutocomplete("from", "fromSuggestions");
    setupAutocomplete("to",   "toSuggestions");

    els.currentLocationBtn.addEventListener("click", () => hydrateCurrentLocation(true));
    els.findRoutesBtn.addEventListener("click", findRoutes);
    els.findWalksBtn.addEventListener("click", () =>
      els.durationControls.classList.toggle("visible"));
    els.generateWalksBtn.addEventListener("click", findWalks);
    els.closeNavigationBtn.addEventListener("click", stopNavigation);
    els.stopNavigationBtn.addEventListener("click", stopNavigation);
    els["start-tour"].addEventListener("click", startMapillaryTour);
    els["stop-tour"].addEventListener("click", stopMapillaryTour);
    els["voice-guidance"].addEventListener("change", (e) => {
      state.voiceEnabled = e.target.checked;
      if (!state.voiceEnabled && window.speechSynthesis) window.speechSynthesis.cancel();
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".location-input-container")) hideSuggestions();
    });
  }
  function onLocationSelected(lat, lng) {
    fetchWalkability(lat, lng);
  }
  // ─── Global Autocomplete (Place Names Only, No Progressive Filtering) ────────
  /**
   * Setup autocomplete for location input.
   * Only shows results AFTER user stops typing (debounced).
   * Does NOT show progressive results (A → AM → AME).
   */
  function setupAutocomplete(inputId, suggestionsId) {
    const input       = els[inputId];
    const suggestions = els[suggestionsId];
    
    // Debounce 500ms - wait for user to finish typing
    const debouncedSearch = debounce(async () => {
      const query = input.value.trim();
      state.selectedPlace[inputId] = null;
      
      // Require minimum 2 characters
      if (query.length < 2) {
        suggestions.style.display = "none";
        suggestions.innerHTML = "";
        return;
      }
      
      // Search globally (no country restriction)
      const results = await searchPlacesGlobal(query);
      renderSuggestions(inputId, suggestions, results);
    }, 500);  // 500ms debounce - don't show partial results

    input.addEventListener("input", debouncedSearch);
    input.addEventListener("keydown", (e) => handleSuggestionKeys(e, suggestions, inputId));
  }

  /**
   * Search for places globally using Nominatim.
   * Returns place names only - NO coordinates shown to user.
   * 
   * @param {string} query - Place name to search
   * @returns {array} Array of place objects with name and country
   */
  async function searchPlacesGlobal(query) {
    // Cancel previous request
    if (state.searchControllers.global) state.searchControllers.global.abort();
    
    const controller = new AbortController();
    state.searchControllers.global = controller;
    
    const url = new URL(NOMINATIM_URL);
    url.search = new URLSearchParams({
      q: query,
      format: "jsonv2",
      addressdetails: "1",
      limit: "8",
      // NO countrycodes - searches worldwide!
    }).toString();

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      
      if (!res.ok) throw new Error("Search service unavailable");
      
      const results = await res.json();
      
      // Filter out very minor places, keep only significant ones
      const filtered = results.filter(place => {
        const type = (place.type || place.class || "").toLowerCase();
        // Include: countries, states, cities, towns, villages, landmarks, amenities
        const minorTypes = ["house", "building", "entrance", "street"];
        return !minorTypes.includes(type);
      });
      
      // Normalize and return - place names only, no coordinates
      return filtered.map(p => normalizePlaceGlobal(p)).slice(0, 8);
      
    } catch (err) {
      if (err.name !== "AbortError") {
        updateStatus("❌ Could not fetch locations. Check your internet.");
      }
      return [];
    }
  }

  /**
   * Normalize Nominatim result to simple place object.
   * Internal: stores lat/lng. UI: shows only name + country.
   */
  function normalizePlaceGlobal(place) {
    const displayName = place.display_name || "";
    const address = place.address || {};
    
    // Extract country (for display)
    const country = address.country || "";
    
    // Extract main name
    const mainName = place.name || displayName.split(",")[0];
    
    // Create display: "Paris, France" (no coordinates!)
    const displayText = country ? `${mainName}, ${country}` : mainName;
    
    return {
      displayText,        // "Paris, France" (for UI)
      mainName,           // "Paris" (for routing)
      country,            // "France" (context)
      // Internal coordinates (hidden from UI)
      lat: Number(place.lat),
      lng: Number(place.lon),
      type: place.type || place.class || "place",
    };
  }

  /**
   * Render autocomplete suggestions.
   * Shows only place names + country, NO coordinates.
   * Shows "No results" only if search failed (not for every keystroke).
   */
  function renderSuggestions(inputId, container, places) {
    if (!places.length) {
      container.innerHTML = '<div class="suggestion-item">❌ No places found - try another name</div>';
      container.style.display = "block";
      return;
    }
    
    // Show place names only - clean, simple UI
    container.innerHTML = places.map((p, i) => `
      <div class="suggestion-item" role="option" data-index="${i}" title="Search for ${p.displayText}">
        <span class="suggestion-title">📍 ${escapeHtml(p.displayText)}</span>
      </div>`).join("");

    Array.from(container.children).forEach((child) => {
      child.addEventListener("click", () =>
        selectSuggestion(inputId, places[Number(child.dataset.index)]));
    });
    
    container.style.display = "block";
  }

  /**
   * Handle keyboard navigation in suggestions.
   */
  function handleSuggestionKeys(e, container, inputId) {
    if (container.style.display !== "block") return;
    
    const items = Array.from(container.querySelectorAll(".suggestion-item[data-index]"));
    if (!items.length) return;
    
    const activeIndex = items.findIndex((item) => item.classList.contains("active"));

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const direction = e.key === "ArrowDown" ? 1 : -1;
      const next = activeIndex < 0 ? 0 : (activeIndex + direction + items.length) % items.length;
      
      items.forEach((item) => item.classList.remove("active"));
      items[next].classList.add("active");
      items[next].scrollIntoView({ block: "nearest" });
    }
    
    if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      items[activeIndex].click();
    }
    
    if (e.key === "Escape") hideSuggestions();
  }

  /**
   * User selected a place from suggestions.
   * Store coordinates internally, show place name in UI.
   */
  function selectSuggestion(inputId, place) {
    // UI shows place name only: "Paris, France"
    els[inputId].value = place.displayText;
    
    // Store full place data internally (with lat/lng hidden)
    state.selectedPlace[inputId] = place;
    state.activeCityBias = place;
    
    hideSuggestions();
    updateStatus(`✅ Selected: ${place.displayText}`);
    
    // Zoom map to selected location
    state.map.setView([place.lat, place.lng], 12);
  }

  function hideSuggestions() {
    els.fromSuggestions.style.display = "none";
    els.toSuggestions.style.display   = "none";
  }

  // ─── Current Location Detection ────────────────────────────────────────────────
  /**
   * Detect user's GPS location and convert to place name.
   * Shows place name in UI, stores coordinates internally.
   */
  async function hydrateCurrentLocation(userInitiated) {
    if (!navigator.geolocation) {
      if (userInitiated) showError("🚫 Your browser does not support location detection.");
      return;
    }
    
    setLocationButtonLoading(true);
    
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        
        // Reverse geocode: coordinates → place name
        const addr = await reverseGeocodeGlobal(lat, lng);
        
        // Create place object (no coordinates shown in UI)
        const place = {
          displayText: addr.displayText,  // "Paris, France" (UI)
          mainName: addr.mainName,        // "Paris" (routing)
          lat,
          lng,
        };
        
        state.selectedPlace.from = place;
        state.currentPosition = place;
        state.activeCityBias = place;
        
        // UI shows: "Paris, France" (no lat/lng!)
        els.from.value = place.displayText;
        
        drawUserPosition(place, accuracy);
        setLocationButtonLoading(false);
        updateStatus(`📍 Current location: ${place.displayText}. Add a destination or generate a walk.`);
      },
      () => {
        setLocationButtonLoading(false);
        if (userInitiated) {
          showError("❌ Could not detect location. Please enable GPS or type a start point.");
        }
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 120000 }
    );
  }
 async function fetchWalkability(lat, lng) {
  try {
    const res = await fetch(
      `https://smartfoot-backend.onrender.com/api/walkability-data?lat=${lat}&lng=${lng}`
    );

    const data = await res.json();

    console.log("API response:", data);

    // Update UI (adjust IDs if needed)
    document.getElementById("safetyScore").innerText = data.safety;
    document.getElementById("greeneryScore").innerText = data.greenery;
    document.getElementById("airScore").innerText = data.air;
    document.getElementById("sidewalkScore").innerText = data.sidewalk;

  } catch (err) {
    console.error("API error:", err);
  }
}
  /**
   * Convert GPS coordinates to place name globally.
   * Returns human-readable name, no coordinates shown.
   */
  async function reverseGeocodeGlobal(lat, lng) {
    const url = new URL(NOMINATIM_REVERSE_URL);
    url.search = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: "jsonv2",
      addressdetails: "1",
      zoom: "18",
    }).toString();
    
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error();
      
      const place = await res.json();
      const address = place.address || {};
      const country = address.country || "";
      
      // Create display text: "City, Country" (no coordinates!)
      const mainName = place.name || place.display_name.split(",")[0];
      const displayText = country ? `${mainName}, ${country}` : mainName;
      
      return { displayText, mainName };
    } catch {
      // Fallback: show something useful, not raw coordinates
      return { displayText: "Current Location", mainName: "Current Location" };
    }
  }

  function setLocationButtonLoading(isLoading) {
    els.currentLocationBtn.classList.toggle("loading", isLoading);
    els.currentLocationBtn.disabled = isLoading;
  }

  // ─── Route Finding: A→B ───────────────────────────────────────────────────────
  /**
   * Find routes from one place to another.
   * Place names auto-converted to coordinates internally.
   */
  async function findRoutes() {
    try {
      setBusy(true, "🔍 Finding route options...");
      clearRoutes();
      
      const from = await resolveLocationName("from");
      const to   = await resolveLocationName("to");
      
      if (!from || !to) {
        showError("❌ Please choose both start and end locations.");
        return;
      }

      const routes = await getRouteAlternatives([from, to], "AtoB");
      
      if (!routes.length) {
        showError("❌ No walking route found. Try nearby places.");
        return;
      }
      
      displayRoutes(routes, "AtoB");
      updateStatus(`✅ Found ${routes.length} route option${routes.length === 1 ? "" : "s"} from ${from.displayText} to ${to.displayText}.`);
    } catch (err) {
      showError(err.message || "❌ Could not calculate routes.");
    } finally {
      setBusy(false);
    }
  }

  // ─── Circular Walk Generation ──────────────────────────────────────────────────
  async function findWalks() {
    try {
      setBusy(true, "🚶 Generating circular walks...");
      clearRoutes();

      const start = await resolveLocationName("from");
      if (!start) {
        showError("❌ Please choose a start location.");
        return;
      }

      const durationMinutes = Number(els.walkDuration.value) || 30;
      const preferences     = getSelectedPreferences();

      const targetMeters = (durationMinutes / 60) * WALKING_SPEED_KMH * 1000;

      const routePromises = LOOP_ANGLE_OFFSETS.map((angleOffset, loopIndex) =>
        buildOptimisedLoop(start, targetMeters, angleOffset, loopIndex, preferences)
      );

      const settled = await Promise.allSettled(routePromises);
      let routes = settled
        .filter((r) => r.status === "fulfilled" && r.value !== null)
        .map((r) => r.value);

      if (routes.length === 0) {
        routes = [createFallbackLoopRoute(start, durationMinutes, preferences)];
      }

      displayRoutes(routes, "Walk");
      updateStatus(`✅ Found ${routes.length} circular walk${routes.length === 1 ? "" : "s"} for ${durationMinutes} minutes from ${start.displayText}.`);
    } catch (err) {
      showError(err.message || "❌ Could not generate walks.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Build optimized circular loop.
   * All coordinates hidden from UI.
   */
  async function buildOptimisedLoop(start, targetMeters, angleOffset, loopIndex, preferences) {
    const baseRadius = targetMeters / (PERIMETER_FACTOR * ROAD_OVERHEAD_FACTOR);
    const minRadius = 60;
    const maxRadius = targetMeters / PERIMETER_FACTOR;

    let bestRoute = null;
    let bestDiff  = Infinity;

    for (const scale of RADIUS_SCALE_FACTORS) {
      const radius    = Math.min(Math.max(baseRadius * scale, minRadius), maxRadius);
      const waypoints = buildLoopWaypoints(start, radius, angleOffset);

      try {
        const data = await getRouteForWaypoints(waypoints);
        if (!isValidRouteData(data)) continue;

        const routeObj = data.routes[0];
        const diff     = Math.abs(routeObj.distance - targetMeters);

        if (diff < bestDiff) {
          bestDiff  = diff;
          bestRoute = routeObj;
        }

        if (diff / targetMeters < 0.10) break;

      } catch (err) {
        console.warn(`Loop scale ${scale} failed:`, err.message);
      }
    }

    if (!bestRoute) return null;

    return decorateRoute(bestRoute, loopIndex, "Walk", start.displayText, preferences);
  }

  function buildLoopWaypoints(start, radius, angleOffset) {
    const bearings = [0, 90, 180, 270].map((b) => b + angleOffset);
    const points   = bearings.map((b) => destinationPoint(start, radius, b));
    return [start, ...points, start];
  }

  // ─── Route Alternatives ───────────────────────────────────────────────────────
  async function getRouteAlternatives(points, type) {
    const direct = await getRouteForWaypoints(points, true);
    if (!isValidRouteData(direct)) return [];

    const routes = direct.routes.map((r, i) => 
      decorateRoute(r, i, type, `${points[0].displayText} → ${points[1].displayText}`)
    );
    
    if (routes.length >= 3) return routes.slice(0, 4);

    const variants = buildViaPointVariants(points[0], points[1]);
    for (const via of variants) {
      if (routes.length >= 3) break;
      try {
        const variant = await getRouteForWaypoints([points[0], via, points[1]], false);
        if (isValidRouteData(variant) && !isDuplicateRoute(routes, variant.routes[0])) {
          routes.push(decorateRoute(
            variant.routes[0], 
            routes.length, 
            type,
            `${points[0].displayText} → ${points[1].displayText}`
          ));
        }
      } catch (_) { }
    }
    
    return routes;
  }

  // ─── OSRM Route Fetching ──────────────────────────────────────────────────────
  async function getRouteForWaypoints(points, alternatives = false) {
    try {
      const coordinates = points.map((p) => `${p.lng},${p.lat}`).join(";");
      const url = `${OSRM_URL}/${coordinates}?overview=full&geometries=geojson&steps=true&alternatives=${alternatives}`;
      
      const res = await fetch(url);
      if (!res.ok) return null;
      
      return await res.json();
    } catch (err) {
      console.error("OSRM fetch failed:", err);
      return null;
    }
  }

  function isValidRouteData(data) {
    return (
      data != null &&
      Array.isArray(data.routes) &&
      data.routes.length > 0 &&
      data.routes[0]?.geometry?.coordinates?.length > 1
    );
  }

  // ─── Route Decoration (UI Display) ─────────────────────────────────────────────
  /**
   * Transform OSRM route to UI-ready format.
   * Shows place names, not coordinates.
   */
  function decorateRoute(route, index, type, locationDisplay = "", preferences = []) {
    try {
      const path = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
      const steps = (route.legs || []).flatMap((leg) => leg.steps || []);
      const score = calculateSafetyScore(route, preferences, index);
      const realisticDurationSeconds = calculateWalkingDurationSeconds(route.distance);
      const distanceKm = route.distance / 1000;

      return {
        id:             `${type}-${index}-${Math.round(route.distance)}`,
        type,
        summary:        type === "Walk" ? `🚶 Circular Walk ${index + 1}` : `🛣️ Route ${index + 1}`,
        distance:       formatDistance(route.distance),
        duration:       formatDuration(realisticDurationSeconds),
        distanceMeters: route.distance,
        durationSeconds: realisticDurationSeconds,
        safetyScore:    score,
        features:       preferences,
        path,
        steps,
        raw:            route,
        // UI shows place names, not coordinates
        from_location:  locationDisplay.split(" → ")[0] || "Start",
        to_location:    locationDisplay.split(" → ")[1] || (type === "Walk" ? "Return" : "Destination"),
        waypoints:      route.legs && route.legs.length > 1
                          ? `${route.legs.length - 1} waypoint${route.legs.length > 2 ? "s" : ""}`
                          : "Direct route",
        recommendation: distanceKm < 1.5
                          ? "⚡ Short walk"
                          : score >= 80
                            ? "⭐ Best option"
                            : "✨ Good alternate",
      };
    } catch (err) {
      console.error("Route decoration failed:", err);
      return null;
    }
  }

  // ─── Fallback Loop ────────────────────────────────────────────────────────────
  function createFallbackLoopRoute(start, durationMinutes, preferences) {
    const totalMeters = (durationMinutes / 60) * WALKING_SPEED_KMH * 1000;
    const radius = Math.min(Math.max(totalMeters / PERIMETER_FACTOR, 60), totalMeters / 2);

    const cardinal    = [0, 90, 180, 270].map((b) => destinationPoint(start, radius, b));
    const loop        = [start, ...cardinal, start];
    const coordinates = loop.map((p) => [p.lng, p.lat]);

    const distance = coordinates.slice(1).reduce((sum, coord, i) => {
      const prev = coordinates[i];
      return sum + haversine({ lat: prev[1], lng: prev[0] }, { lat: coord[1], lng: coord[0] });
    }, 0);

    const syntheticRoute = {
      distance,
      geometry: { coordinates },
      legs: [{
        steps: coordinates.slice(1).map((coord, i) => ({
          distance:  distance / (coordinates.length - 1),
          name:      "Walking path",
          maneuver:  { type: i === 0 ? "depart" : "turn", modifier: "slight right" },
        })),
      }],
    };

    return decorateRoute(syntheticRoute, 0, "Walk", start.displayText, preferences);
  }

  // ─── Display Routes on Map & UI ───────────────────────────────────────────────
  function displayRoutes(routes, type) {
    state.routes = routes;
    els.routesList.innerHTML = "";
    
    routes.forEach((route, index) => {
      if (!route) return;
      drawRoute(route, index, index === 0);
      addRouteCard(route, index, type);
    });
    
    if (routes[0]) focusRoute(0);
  }

  function drawRoute(route, index, visible) {
    const polyline = L.polyline(
      route.path.map((p) => [p.lat, p.lng]),
      {
        color:   COLORS[index % COLORS.length],
        weight:  visible ? 7 : 5,
        opacity: visible ? 0.92 : 0.38,
        lineCap: "round",
        lineJoin: "round",
      }
    );
    
    route.polyline = polyline;
    polyline.addTo(state.routeLayer);

    if (route.path.length) {
      const s = route.path[0];
      const e = route.path[route.path.length - 1];
      
      route.startMarker = L.marker([s.lat, s.lng], { title: "Start" }).addTo(state.markers);
      route.endMarker   = L.marker([e.lat, e.lng], {
        title: route.type === "Walk" ? "Return" : "Destination",
      }).addTo(state.markers);
    }
  }

  function addRouteCard(route, index, type) {
    const div = document.createElement("div");
    div.className = "route-option";
    div.dataset.routeIndex = String(index);
    
    const featureTags = type === "Walk" ? route.features.map(featureTag).join("") : "";

    div.innerHTML = `
      <h3>${escapeHtml(route.summary)}</h3>
      ${featureTags}
      <p><strong>From:</strong> ${escapeHtml(route.from_location)}</p>
      <p><strong>To:</strong> ${escapeHtml(route.to_location)}</p>
      <p><strong>📏 Distance:</strong> ${route.distance}</p>
      <p><strong>⏱️ Duration:</strong> ${route.duration}</p>
      <p><strong>🔒 Safety:</strong> ${route.safetyScore}%</p>
      <p><strong>💡 Recommendation:</strong> ${escapeHtml(route.recommendation)}</p>
      <div class="route-actions">
        <button type="button" data-action="focus"><i class="fas fa-map-marker-alt"></i> Focus</button>
        <button type="button" data-action="street"><i class="fas fa-street-view"></i> Mapillary</button>
        <button type="button" data-action="navigate" style="background-color:#1a73e8;">
          <i class="fas fa-directions"></i> Navigate
        </button>
      </div>`;

    div.querySelector('[data-action="focus"]').addEventListener("click", () => focusRoute(index));
    div.querySelector('[data-action="street"]').addEventListener("click", () => {
      focusRoute(index);
      startMapillaryTour();
    });
    div.querySelector('[data-action="navigate"]').addEventListener("click", () => startNavigation(index));
    
    els.routesList.appendChild(div);
  }

  function focusRoute(index) {
    const route = state.routes[index];
    if (!route) return;
    
    state.selectedRouteIndex = index;
    
    state.routes.forEach((r, i) => {
      if (!r?.polyline) return;
      r.polyline.setStyle({
        weight:  i === index ? 7 : 5,
        opacity: i === index ? 0.92 : 0.25,
      });
    });
    
    document.querySelectorAll(".route-option").forEach((card) => {
      card.classList.toggle("selected", Number(card.dataset.routeIndex) === index);
    });
    
    state.map.fitBounds(route.polyline.getBounds(), { padding: [34, 34] });
    updateStatus(`✅ ${route.summary}: ${route.distance} • ${route.duration}`);
  }

  // ─── Navigation ───────────────────────────────────────────────────────────────
  function startNavigation(index) {
    const route = state.routes[index];
    if (!route?.path?.length) {
      showError("❌ Select a route before navigating.");
      return;
    }

    stopNavigation(false);
    focusRoute(index);
    
    state.navigationRoute       = route;
    state.navigationDestination = route.path[route.path.length - 1];
    
    els["navigation-panel"].classList.add("visible");
    startMapillaryTour();
    updateNavigationUI(route, null);
    speak(`🎙️ Starting navigation: ${route.summary}`);

    const markerIcon = L.divIcon({
      className: "",
      html: '<div class="live-user-marker"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    
    const initial = state.currentPosition || route.path[0];
    state.navigationMarker = L.marker([initial.lat, initial.lng], { icon: markerIcon }).addTo(state.userLayer);

    if (!navigator.geolocation) {
      showError("🚫 Live navigation requires GPS support.");
      return;
    }

    state.watchPositionId = navigator.geolocation.watchPosition(
      (pos) => handleNavigationPosition(pos, route),
      () => updateStatus("📡 Waiting for GPS signal..."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );
    
    updateStatus("📍 Live navigation started. Follow the route!");
  }

  function handleNavigationPosition(position, route) {
    const userPoint = {
      lat:      position.coords.latitude,
      lng:      position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
    
    state.currentPosition = userPoint;
    state.navigationMarker.setLatLng([userPoint.lat, userPoint.lng]);
    state.map.setView([userPoint.lat, userPoint.lng], Math.max(state.map.getZoom(), 16), { animate: true });

    const destDist = haversine(userPoint, state.navigationDestination);
    updateNavigationUI(route, userPoint, destDist);
    updateMapillaryFrame(userPoint);

    if (destDist <= ARRIVAL_THRESHOLD_METERS) {
      updateStatus("🎉 Destination reached!");
      speak("You have arrived at your destination.");
      stopNavigation(false);
    } else {
      updateStatus(`📍 ${formatDistance(destDist)} to destination`);
    }
  }

  function updateNavigationUI(route, userPoint, destinationDistance = null) {
    const steps   = route.steps.filter((s) => s.maneuver);
    const progress = getClosestStepIndex(route, userPoint);
    const current  = steps[progress];
    const next     = steps[progress + 1];

    els["current-instruction"].textContent = instructionText(current, "Follow the route");
    els["current-distance"].textContent    = current
      ? `${formatDistance(current.distance)} | ${formatDuration(calculateWalkingDurationSeconds(current.distance))}`
      : `${route.distance} | ${route.duration}`;
    
    els["next-instruction"].textContent = next ? instructionText(next, "Continue") : "📍 Destination";
    els["next-distance"].textContent    = next
      ? `${formatDistance(next.distance)} | ${formatDuration(calculateWalkingDurationSeconds(next.distance))}`
      : destinationDistance == null ? "" : `${formatDistance(destinationDistance)} away`;
  }

  function stopNavigation(hidePanel = true) {
    if (state.watchPositionId !== null) {
      navigator.geolocation.clearWatch(state.watchPositionId);
    }
    
    state.watchPositionId       = null;
    state.navigationRoute       = null;
    state.navigationDestination = null;
    state.userLayer.clearLayers();
    
    if (hidePanel) els["navigation-panel"].classList.remove("visible");
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  // ─── Mapillary Street View ────────────────────────────────────────────────────
  function startMapillaryTour() {
    const route = state.routes[state.selectedRouteIndex];
    if (!route?.path?.length) {
      showError("❌ Select a route first.");
      return;
    }

    stopMapillaryTour(false);
    els["street-view"].classList.add("visible");
    showStreetViewMessage("📸 Loading street view...");
    
    state.mapillaryStep   = 0;
    state.mapillaryPoints = samplePath(route.path, Math.min(24, Math.max(8, Math.round(route.path.length / 8))));
    updateMapillaryFrame(route.path[0]);

    const speed = Number(els["tour-speed"].value);
    state.mapillaryTimer = window.setInterval(() => {
      state.mapillaryStep = (state.mapillaryStep + 1) % state.mapillaryPoints.length;
      updateMapillaryFrame(state.mapillaryPoints[state.mapillaryStep]);
    }, speed);

    updateStatus("📸 Mapillary street view tour started.");
  }

  async function updateMapillaryFrame(point) {
    const appUrl = `https://www.mapillary.com/app/?lat=${point.lat.toFixed(6)}&lng=${point.lng.toFixed(6)}&z=17`;
    els.mapillaryExternalLink.href = appUrl;

    const imageKey = await findMapillaryImageKey(point);
    if (!imageKey) {
      els.mapillaryFrame.removeAttribute("src");
      showStreetViewMessage("📸 No imagery available here");
      return;
    }
    
    els.streetViewEmpty.style.display = "none";
    els.mapillaryFrame.style.display  = "block";
    els.mapillaryFrame.src = `https://www.mapillary.com/embed?image_key=${encodeURIComponent(imageKey)}&style=classic`;
  }

  function stopMapillaryTour(hidePanel = false) {
    if (state.mapillaryTimer) window.clearInterval(state.mapillaryTimer);
    state.mapillaryTimer  = null;
    state.mapillaryPoints = [];
    if (hidePanel) els["street-view"].classList.remove("visible");
  }

  function clearRoutes() {
    stopNavigation();
    stopMapillaryTour(true);
    state.routeLayer.clearLayers();
    state.markers.clearLayers();
    state.routes            = [];
    state.selectedRouteIndex = -1;
  }

  function drawUserPosition(place, accuracy) {
    L.circleMarker([place.lat, place.lng], {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#1a73e8",
      fillOpacity: 1,
    }).addTo(state.markers);

    if (accuracy) {
      L.circle([place.lat, place.lng], {
        radius: accuracy,
        color: "#1a73e8",
        opacity: 0.35,
        fillColor: "#1a73e8",
        fillOpacity: 0.08,
      }).addTo(state.markers);
    }
    
    state.map.setView([place.lat, place.lng], 15);
  }

  // ─── Via-Point Variants ───────────────────────────────────────────────────────
  function buildViaPointVariants(from, to) {
    const mid      = { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 };
    const distance = haversine(from, to);
    const offset   = Math.min(Math.max(distance * 0.18, 350), 1800);
    const bearing  = bearingBetween(from, to);
    
    return [
      destinationPoint(mid, offset, bearing + 90),
      destinationPoint(mid, offset, bearing - 90),
      destinationPoint(mid, offset * 0.7, bearing + 45),
    ];
  }

  // ─── Input Resolution (Place Name → Coordinates) ──────────────────────────────
  /**
   * Resolve a place name to coordinates.
   * If user selected from suggestions: use that.
   * If user typed manually: auto-geocode it.
   * If nothing: show error.
   */
  async function resolveLocationName(inputId) {
    // Already selected from suggestions?
    if (state.selectedPlace[inputId]) {
      return state.selectedPlace[inputId];
    }
    
    // User typed something manually?
    const value = els[inputId].value.trim();
    if (!value) return null;
    
    // Auto-geocode the typed name
    const results = await searchPlacesGlobal(value);
    if (!results.length) {
      showError(`❌ Could not find "${value}". Please check the spelling.`);
      return null;
    }
    
    const place = results[0];
    state.selectedPlace[inputId] = place;
    
    // Update UI to show resolved place name
    els[inputId].value = place.displayText;
    
    return place;
  }

  // ─── Safety Score ─────────────────────────────────────────────────────────────
  function calculateSafetyScore(route, preferences, index) {
    let score = 76;
    const distKm = route.distance / 1000;
    
    if (distKm <= 2) score += 6;
    if (distKm >  5) score -= 4;
    if (preferences.includes("greenery"))   score += 4;
    if (preferences.includes("waterfront")) score += 3;
    if (preferences.includes("quiet"))      score += 3;
    
    score -= index * 2;
    return Math.max(55, Math.min(96, Math.round(score)));
  }

  function isDuplicateRoute(existingRoutes, route) {
    return existingRoutes.some((r) => Math.abs(r.distanceMeters - route.distance) < 80);
  }

  function getSelectedPreferences() {
    return Array.from(
      document.querySelectorAll('.preference-options input[type="checkbox"]:checked')
    ).map((el) => el.value);
  }

  function featureTag(feature) {
    const labels = {
      greenery:  ["fa-tree",       "🌳 Greenery"],
      scenic:    ["fa-mountain",   "🏔️ Scenic"],
      amenities: ["fa-store",      "🏪 Shops"],
      quiet:     ["fa-volume-mute","🔇 Quiet"],
      waterfront:["fa-water",      "💧 Waterfront"],
    };
    const [icon, label] = labels[feature] || ["fa-route", feature];
    return `<span class="route-feature-tag"><i class="fas ${icon}"></i> ${label}</span>`;
  }

  // ─── Navigation Helpers ───────────────────────────────────────────────────────
  function instructionText(step, fallback) {
    if (!step?.maneuver) return fallback;
    
    const road     = step.name ? ` on ${step.name}` : "";
    const modifier = step.maneuver.modifier ? `${step.maneuver.modifier} ` : "";
    
    return `${capitalize(step.maneuver.type.replace(/_/g, " "))} ${modifier}${road}`
      .replace(/\s+/g, " ")
      .trim();
  }

  function samplePath(path, count) {
    if (path.length <= count) return path;
    const sampled = [];
    for (let i = 0; i < count; i++) {
      sampled.push(path[Math.floor((i / (count - 1)) * (path.length - 1))]);
    }
    return sampled;
  }

  function getClosestStepIndex(route, userPoint) {
    if (!userPoint) return 0;
    const steps = route.steps.filter((s) => s.maneuver);
    if (!steps.length) return 0;
    
    let closestIndex = 0, closestDistance = Infinity;
    steps.forEach((step, i) => {
      const loc = step.maneuver.location;
      if (!loc) return;
      const dist = haversine(userPoint, { lng: loc[0], lat: loc[1] });
      if (dist < closestDistance) {
        closestDistance = dist;
        closestIndex = i;
      }
    });
    return closestIndex;
  }

  // ─── Mapillary ────────────────────────────────────────────────────────────────
  async function findMapillaryImageKey(point) {
    const token = window.MAPILLARY_ACCESS_TOKEN;
    if (!token) return null;
    
    const delta = 0.0018;
    const bbox  = [point.lng - delta, point.lat - delta, point.lng + delta, point.lat + delta].join(",");
    const url   = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}&fields=id,computed_geometry&limit=1&bbox=${bbox}`;
    
    try {
      const res  = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const data = await res.json();
      return data.data?.[0]?.id || null;
    } catch {
      return null;
    }
  }

  function showStreetViewMessage(message) {
    els.mapillaryFrame.style.display = "none";
    els.streetViewEmpty.style.display = "block";
    els.streetViewEmpty.textContent   = message;
  }

  // ─── UI Helpers ───────────────────────────────────────────────────────────────
  function setBusy(isBusy, message) {
    els.findRoutesBtn.disabled    = isBusy;
    els.generateWalksBtn.disabled = isBusy;
    
    if (isBusy) {
      els.routesList.innerHTML = `<div class="loading-container"><i class="fas fa-spinner fa-spin"></i> ${escapeHtml(message)}</div>`;
      updateStatus(message);
    }
  }

  function updateStatus(message) {
    els.status.textContent = message;
  }

  function showError(message) {
    els.routesList.innerHTML = `<div class="error" role="alert">${escapeHtml(message)}</div>`;
    updateStatus(message);
  }

  function speak(message) {
    if (!state.voiceEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));
  }

  // ─── Geospatial Math ──────────────────────────────────────────────────────────
  function destinationPoint(point, distanceMeters, bearingDegrees) {
    const R  = 6371000;
    const δ  = distanceMeters / R;
    const θ  = toRadians(bearingDegrees);
    const φ1 = toRadians(point.lat);
    const λ1 = toRadians(point.lng);
    
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    
    return { lat: toDegrees(φ2), lng: toDegrees(λ2) };
  }

  function haversine(a, b) {
    const R    = 6371000;
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const h    = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function bearingBetween(a, b) {
    const φ1   = toRadians(a.lat), φ2 = toRadians(b.lat);
    const dLng = toRadians(b.lng - a.lng);
    const y    = Math.sin(dLng) * Math.cos(φ2);
    const x    = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
    return (toDegrees(Math.atan2(y, x)) + 360) % 360;
  }

  function formatDistance(meters) {
    return meters < 1000
      ? `${Math.round(meters)} m`
      : `${(meters / 1000).toFixed(1)} km`;
  }

  function formatDuration(seconds) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return `${h} hr${m ? ` ${m} min` : ""}`;
  }

  function calculateWalkingDurationSeconds(distanceMeters) {
    return Math.max(60, Math.round((distanceMeters / 1000 / WALKING_SPEED_KMH) * 3600));
  }

  // ─── String Utilities ─────────────────────────────────────────────────────────
  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), delay);
    };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function toRadians(deg) {
    return (deg * Math.PI) / 180;
  }

  function toDegrees(rad) {
    return (rad * 180) / Math.PI;
  }

})();
