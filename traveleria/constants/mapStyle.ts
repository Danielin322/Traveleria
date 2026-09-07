/**
 * Dark map styling for react-native-maps.
 *
 * Google Maps does not follow the app's colour scheme, so in dark mode the
 * map would otherwise stay bright white inside an otherwise dark screen.
 * Applied via MapView's `customMapStyle` prop (Android and iOS with the
 * Google provider; Apple Maps ignores it and follows the system instead).
 */
export const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#212b31" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9ba1a6" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212b31" }] },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ color: "#3a444d" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#7d8891" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#1b3025" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#2c353c" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9ba1a6" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#3c464f" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#2f3a42" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#17242d" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#51606b" }],
  },
];
