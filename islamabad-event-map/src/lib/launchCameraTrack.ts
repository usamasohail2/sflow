/**
 * Pre-baked launch fly-through.
 *
 * Recorded once with Mapbox terrain OFF (jumpTo each pose → capture free-camera
 * eye lng/lat/altitude). Runtime plays these poses via setFreeCameraOptions with
 * terrain ON, so mountains render but the eye path is not re-estimated from DEM.
 */
export type LaunchKeyframe = {
  /** Normalized time along the track, 0 → 1 */
  t: number;
  /** Look-at center (for end jumpTo / debugging) */
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
  /** Free-camera eye — baked with terrain off */
  eyeLng: number;
  eyeLat: number;
  /** Meters above ellipsoid — baked with terrain off */
  altitude: number;
};

export const LAUNCH_CAMERA_TRACK: readonly LaunchKeyframe[] = [
  { t: 0, lng: 73.0372, lat: 33.7299, zoom: 16.5, pitch: 77, bearing: -28, eyeLng: 73.042139, eyeLat: 33.722174, altitude: 971.17 },
  { t: 0.025, lng: 73.0372, lat: 33.72989, zoom: 16.5, pitch: 77, bearing: -28, eyeLng: 73.042139, eyeLat: 33.722164, altitude: 971.1 },
  { t: 0.05, lng: 73.03723, lat: 33.72986, zoom: 16.5, pitch: 77, bearing: -28, eyeLng: 73.042169, eyeLat: 33.722134, altitude: 970.74 },
  { t: 0.075, lng: 73.03729, lat: 33.72975, zoom: 16.5, pitch: 77, bearing: -28, eyeLng: 73.042229, eyeLat: 33.722024, altitude: 969.7 },
  { t: 0.1, lng: 73.03741, lat: 33.72955, zoom: 16.5, pitch: 77, bearing: -28, eyeLng: 73.042349, eyeLat: 33.721824, altitude: 967.84 },
  { t: 0.125, lng: 73.03761, lat: 33.72922, zoom: 16.5, pitch: 77, bearing: -28, eyeLng: 73.042549, eyeLat: 33.721494, altitude: 965.04 },
  { t: 0.15, lng: 73.03791, lat: 33.72872, zoom: 16.5, pitch: 77, bearing: -28, eyeLng: 73.042849, eyeLat: 33.720994, altitude: 962.39 },
  { t: 0.175, lng: 73.03833, lat: 33.72803, zoom: 16.499, pitch: 77, bearing: -28, eyeLng: 73.043273, eyeLat: 33.720298, altitude: 961.32 },
  { t: 0.2, lng: 73.03888, lat: 33.72711, zoom: 16.497, pitch: 77, bearing: -28, eyeLng: 73.04383, eyeLat: 33.719367, altitude: 960.7 },
  { t: 0.225, lng: 73.03959, lat: 33.72593, zoom: 16.492, pitch: 77, bearing: -28, eyeLng: 73.044557, eyeLat: 33.71816, altitude: 960.02 },
  { t: 0.25, lng: 73.04048, lat: 33.72445, zoom: 16.482, pitch: 77, bearing: -28, eyeLng: 73.045481, eyeLat: 33.716626, altitude: 957.73 },
  { t: 0.275, lng: 73.04157, lat: 33.72265, zoom: 16.463, pitch: 77, bearing: -28, eyeLng: 73.046638, eyeLat: 33.714722, altitude: 952.65 },
  { t: 0.3, lng: 73.04287, lat: 33.72048, zoom: 16.433, pitch: 77, bearing: -28, eyeLng: 73.048044, eyeLat: 33.712386, altitude: 951.42 },
  { t: 0.325, lng: 73.04441, lat: 33.71793, zoom: 16.388, pitch: 77, bearing: -28, eyeLng: 73.049748, eyeLat: 33.709579, altitude: 952.44 },
  { t: 0.35, lng: 73.0462, lat: 33.71495, zoom: 16.322, pitch: 77, bearing: -28, eyeLng: 73.051788, eyeLat: 33.706208, altitude: 960.75 },
  { t: 0.375, lng: 73.04827, lat: 33.71151, zoom: 16.232, pitch: 77, bearing: -28, eyeLng: 73.054218, eyeLat: 33.702204, altitude: 973.33 },
  { t: 0.4, lng: 73.05064, lat: 33.70758, zoom: 16.11, pitch: 77, bearing: -28, eyeLng: 73.057113, eyeLat: 33.697453, altitude: 986.55 },
  { t: 0.425, lng: 73.05332, lat: 33.70312, zoom: 15.951, pitch: 77, bearing: -28, eyeLng: 73.060547, eyeLat: 33.691812, altitude: 1014.58 },
  { t: 0.45, lng: 73.05634, lat: 33.69812, zoom: 15.747, pitch: 77, bearing: -28, eyeLng: 73.064664, eyeLat: 33.685094, altitude: 1050.88 },
  { t: 0.475, lng: 73.05971, lat: 33.69252, zoom: 15.491, pitch: 77, bearing: -28, eyeLng: 73.069651, eyeLat: 33.676963, altitude: 1118.64 },
  { t: 0.5, lng: 73.06345, lat: 33.6863, zoom: 15.176, pitch: 77, bearing: -28, eyeLng: 73.075816, eyeLat: 33.666945, altitude: 1221.25 },
  { t: 0.525, lng: 73.06719, lat: 33.68008, zoom: 14.792, pitch: 77, bearing: -28, eyeLng: 73.083328, eyeLat: 33.65482, altitude: 1379.65 },
  { t: 0.55, lng: 73.07056, lat: 33.67448, zoom: 14.329, pitch: 77, bearing: -28, eyeLng: 73.092804, eyeLat: 33.639658, altitude: 1658.34 },
  { t: 0.575, lng: 73.07358, lat: 33.66948, zoom: 13.812, pitch: 77, bearing: -28, eyeLng: 73.105411, eyeLat: 33.619643, altitude: 2093.76 },
  { t: 0.6, lng: 73.07626, lat: 33.66502, zoom: 13.366, pitch: 77, bearing: -28, eyeLng: 73.119622, eyeLat: 33.597119, altitude: 2615.49 },
  { t: 0.625, lng: 73.07863, lat: 33.66109, zoom: 12.996, pitch: 77, bearing: -28, eyeLng: 73.134669, eyeLat: 33.573323, altitude: 3197.74 },
  { t: 0.65, lng: 73.0807, lat: 33.65765, zoom: 12.693, pitch: 77, bearing: -28, eyeLng: 73.149835, eyeLat: 33.549354, altitude: 3795.44 },
  { t: 0.675, lng: 73.08249, lat: 33.65467, zoom: 12.448, pitch: 77, bearing: -28, eyeLng: 73.164422, eyeLat: 33.52631, altitude: 4376.02 },
  { t: 0.7, lng: 73.08403, lat: 33.65212, zoom: 12.254, pitch: 77, bearing: -28, eyeLng: 73.177754, eyeLat: 33.505265, altitude: 4913.66 },
  { t: 0.725, lng: 73.08533, lat: 33.64995, zoom: 12.103, pitch: 77, bearing: -28, eyeLng: 73.189395, eyeLat: 33.486872, altitude: 5383.11 },
  { t: 0.75, lng: 73.08642, lat: 33.64815, zoom: 11.988, pitch: 77, bearing: -28, eyeLng: 73.19912, eyeLat: 33.471523, altitude: 5777.91 },
  { t: 0.775, lng: 73.08731, lat: 33.64667, zoom: 11.903, pitch: 77, bearing: -28, eyeLng: 73.20685, eyeLat: 33.459309, altitude: 6090.73 },
  { t: 0.8, lng: 73.08802, lat: 33.64549, zoom: 11.842, pitch: 77, bearing: -28, eyeLng: 73.212723, eyeLat: 33.450026, altitude: 6322.92 },
  { t: 0.825, lng: 73.08857, lat: 33.64457, zoom: 11.8, pitch: 77, bearing: -28, eyeLng: 73.216956, eyeLat: 33.443323, altitude: 6493.18 },
  { t: 0.85, lng: 73.08899, lat: 33.64388, zoom: 11.772, pitch: 77, bearing: -28, eyeLng: 73.219892, eyeLat: 33.438683, altitude: 6608.43 },
  { t: 0.875, lng: 73.08929, lat: 33.64338, zoom: 11.756, pitch: 77, bearing: -28, eyeLng: 73.221652, eyeLat: 33.43589, altitude: 6676.84 },
  { t: 0.9, lng: 73.08949, lat: 33.64305, zoom: 11.746, pitch: 77, bearing: -28, eyeLng: 73.222773, eyeLat: 33.434115, altitude: 6719.03 },
  { t: 0.925, lng: 73.08961, lat: 33.64285, zoom: 11.742, pitch: 77, bearing: -28, eyeLng: 73.223263, eyeLat: 33.433333, altitude: 6735.63 },
  { t: 0.95, lng: 73.08967, lat: 33.64274, zoom: 11.74, pitch: 77, bearing: -28, eyeLng: 73.223508, eyeLat: 33.432932, altitude: 6743.95 },
  { t: 0.975, lng: 73.0897, lat: 33.64271, zoom: 11.74, pitch: 77, bearing: -28, eyeLng: 73.223538, eyeLat: 33.432902, altitude: 6743.86 },
  { t: 1, lng: 73.0897, lat: 33.6427, zoom: 11.74, pitch: 77, bearing: -28, eyeLng: 73.223538, eyeLat: 33.432892, altitude: 6743.86 },
] as const;
