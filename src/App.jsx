import { useEffect, useMemo, useRef, useState } from "react";

import { ClassNames } from "@emotion/react";
import { Delete } from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  Paper,
  TextField,
} from "@mui/material";
import Grid from "@mui/material/Unstable_Grid2";

import "./App.css";
import {
  calcCumLevel,
  cervicalLevels,
  lumbarLevels,
  thoracicLevels,
  validLevels,
} from "./SpineHelper";
import { loadPyodide } from "pyodide";

var MODE_SPLINE = "spline";
var MODE_SPINE_VEC = "spine_vec";

function App() {
  // State to track pyodide construction so that we don't use it before it's ready.
  const [pyodide, setPyodide] = useState(null);

  // The displayed image.
  const [selectedImage, setSelectedImage] = useState(null);

  // List of points added by the user.
  const [coordinates, setCoordinates] = useState([]);

  // Newly added point that has not been confirmed by user.
  const [newCoord, setNewCoord] = useState(null);

  // State for the dialog box that prompts users to label their new point.
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogTextRef = useRef(null);

  // State for the weight input text field.
  const weightTextRef = useRef(null);

  const [shouldDrawSpline, setShouldDrawSpline] = useState(false);
  const [shouldDrawSpineVec, setShouldDrawSpineVec] = useState(false);

  const canvasRef = useRef(null);

  // Python Init --------------------------------------------------------------

  useEffect(() => {
    async function makePyodide() {
      let newPyodide = await loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/",
      });
      await newPyodide.loadPackage(["numpy", "scipy"]);

      // Set up our imports and helper functions.
      await newPyodide.runPythonAsync(`
        import numpy as np
        import scipy
        from scipy.interpolate import CubicSpline

        def calculate_angles(spline, x_values):
          dx = spline.derivative(1)(x_values)  # First derivative
          dy = np.ones_like(dx)
          tangent_vectors = np.stack((dx, dy), axis=-1)
          normalized_tangent_vectors = tangent_vectors / np.linalg.norm(tangent_vectors, axis=-1, keepdims=True)
          angles = np.arctan2(normalized_tangent_vectors[:, 0], normalized_tangent_vectors[:, 1])
          return np.degrees(angles)
        
        def calculate_vector(weight, level, angle):
          print('Calculating vector for {}, {}, {}'.format(weight, level, angle))
          return np.abs(scipy.constants.g * weight * np.sin(np.radians(angle)) * level/58)
        def calculate_vector_normal(weight, level, angle):
          return np.abs(scipy.constants.g * weight * np.cos(np.radians(angle)) * level/58)

        def calculate_vector_S_non_abs(weight, level, angle):
          return scipy.constants.g * weight * np.sin(np.radians(angle)) * level/58
        def calculate_vector_O_non_abs(weight, level, angle):
          return scipy.constants.g * weight * np.cos(np.radians(angle)) * level/58
      `);
      setPyodide(newPyodide);
    }
    if (pyodide == null) {
      makePyodide();
    }
  }, []);

  const spineVector = useMemo(() => {
    let sortedCoords = [...coordinates];
    sortedCoords.sort((a, b) => {
      return a.y < b.y ? -1 : 1;
    });
    globalThis.xVals = sortedCoords.map((c) => c.x);
    globalThis.yVals = sortedCoords.map((c) => c.y);

    // Default to a weight of 60 kg.
    let weight = 60.0;
    if (weightTextRef.current) {
      weight = Number.parseFloat(weightTextRef.current.value);
    }

    console.log("Performing calculations with weight of " + weight);

    let levelParams = calcCumLevel();

    // In order to bridge JS objects into Pyodide, we have to assign them
    // to the global scope.
    globalThis.w = weight;
    globalThis.level = sortedCoords.map((c) => c.label);

    globalThis.cumulativeLevelProportion =
      levelParams.cumulativeLevelProportion;
    globalThis.cumulativeSingleLevelProportion =
      levelParams.cumulativeSingleLevelProportion;
    globalThis.cervicalLevels = cervicalLevels;
    globalThis.thoracicLevels = thoracicLevels;
    globalThis.lumbarLevels = lumbarLevels;

    // Make sure the labels are spinal levels (not arbitrary text) and that we have at least two
    // cervical, thoracic, and lumbar points. Otherwise, the vector calculations will fail.
    let numCervicalLabels = 0;
    let numThoracicLevels = 0;
    let numLumbarLevels = 0;
    for (let i = 0; i < sortedCoords.length; i++) {
      let label = sortedCoords[i].label;
      if (cervicalLevels.includes(label)) {
        numCervicalLabels += 1;
      } else if (thoracicLevels.includes(label)) {
        numThoracicLevels += 1;
      } else if (lumbarLevels.includes(label)) {
        numLumbarLevels += 1;
      }
    }
    if (numCervicalLabels < 2 || numThoracicLevels < 2 || numLumbarLevels < 2) {
      return null;
    }

    pyodide.runPython(`
      import js

      # Load in instance variables bridged from JS
      w = js.w
      level = js.level.to_py()

      # Set up constants (also bridged from JS)
      cumulative_level_proportion = js.cumulativeLevelProportion.to_py()
      cumulative_single_level_proportion = js.cumulativeSingleLevelProportion.to_py()
      cervical_levels = js.cervicalLevels.to_py()
      thoracic_levels = js.thoracicLevels.to_py()
      lumbar_levels = js.lumbarLevels.to_py()
    
      y = np.asarray(js.yVals.to_py())
      x = np.asarray(js.xVals.to_py())
      cs = CubicSpline(y, x, bc_type='natural')   

      angles = calculate_angles(cs, y)
      
      vec_mag = [calculate_vector(w, cumulative_single_level_proportion[l], a) for a, l in zip(angles, level)]
      vec_mag_normal = [calculate_vector_normal(w, cumulative_single_level_proportion[l], a) for a, l in
                  zip(angles, level)]

      vec_mag_S_non_abs = [calculate_vector_S_non_abs(w, cumulative_level_proportion[l], a) for a, l in zip(angles, level)]
      vec_mag_O_non_abs = [calculate_vector_O_non_abs(w, cumulative_level_proportion[l], a) for a, l in zip(angles, level)]

      # Determine x and y vectors for each labeled spinal level
      x_e = [m * np.cos(np.radians(ang)) if np.radians(ang) < 0 else -1 * m * np.cos(np.radians(ang)) for _, m, ang in zip(x, vec_mag, angles)]
      y_e = [-1 * m * np.sin(np.radians(ang)) if np.radians(ang) < 0 else m * np.sin(np.radians(ang)) for _, m, ang in zip(y, vec_mag, angles)]

      x_e_n = [m * np.sin(np.radians(ang)) if np.radians(ang) < 0 else m * np.sin(np.radians(ang)) for _, m, ang in zip(x, vec_mag_normal, angles)]
      y_e_n = [m * np.cos(np.radians(ang)) if np.radians(ang) < 0 else m * np.cos(np.radians(ang)) for _, m, ang in zip(y, vec_mag_normal, angles)]

      # Helper function to create the final vectors for all our spinal cord levels.
      def make_vectors(x, y, x_e, y_e):
        return [
          {'start': (x_0, y_0), 'vector': (x_t, y_t), 'label': l} for x_0, y_0, x_t, y_t, l in zip(x, y, x_e, y_e, level)
        ]
      
      vectors_with_starting_coordinates = make_vectors(x, y, x_e, y_e) 
      vectors_with_starting_coordinates_Normal = make_vectors(x, y, x_e_n, y_e_n)

      #=======================================
      
      # Group the above vectors based on the spinal level

      vectors_with_starting_coordinates_cervical = filter(lambda v: v['label'] in cervical_levels, vectors_with_starting_coordinates)
      vectors_with_starting_coordinates_Normal_cervical = filter(lambda v: v['label'] in cervical_levels, vectors_with_starting_coordinates_Normal)

      vectors_with_starting_coordinates_thoracic = filter(lambda v: v['label'] in thoracic_levels, vectors_with_starting_coordinates)
      vectors_with_starting_coordinates_Normal_thoracic = filter(lambda v: v['label'] in thoracic_levels, vectors_with_starting_coordinates_Normal)
      
      vectors_with_starting_coordinates_lumbar = filter(lambda v: v['label'] in lumbar_levels, vectors_with_starting_coordinates)
      vectors_with_starting_coordinates_Normal_lumbar = filter(lambda v: v['label'] in lumbar_levels, vectors_with_starting_coordinates_Normal)

      # Sum up all the vectors within a group to determine the overall vector for that group.

      resultant_vector_cervical = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_cervical], axis=0)
      resultant_vector_normal_cervical = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_Normal_cervical],
                                        axis=0)
      resultant_vector_thoracic = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_thoracic], axis=0)
      resultant_vector_normal_thoracic = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_Normal_thoracic],
                                        axis=0)
      resultant_vector_lumbar = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_lumbar], axis=0)
      resultant_vector_normal_lumbar = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_Normal_lumbar],
                                        axis=0)

      # Determine the magnitude/norm of the resultant vectors.

      sum_mag_cervical = round(np.linalg.norm(resultant_vector_cervical), 0)
      sum_mag_normal_cervical = round(np.linalg.norm(resultant_vector_normal_cervical), 0)

      sum_mag_thoracic = round(np.linalg.norm(resultant_vector_thoracic), 0)
      sum_mag_normal_thoracic = round(np.linalg.norm(resultant_vector_normal_thoracic), 0)

      sum_mag_lumbar = round(np.linalg.norm(resultant_vector_lumbar), 0)
      sum_mag_normal_lumbar = round(np.linalg.norm(resultant_vector_normal_lumbar), 0)      
      
      # Calculate the angle in radians
      angle_radians_cervical = np.arctan2(resultant_vector_cervical[1], resultant_vector_cervical[0])
      # Convert to degrees
      angle_degrees_cervical = round(np.degrees(angle_radians_cervical), 0)

      # Calculate the angle in radians
      angle_radians_thoracic = np.arctan2(resultant_vector_thoracic[1], resultant_vector_thoracic[0])
      # Convert to degrees
      angle_degrees_thoracic = round(np.degrees(angle_radians_thoracic), 0)

      # Calculate the angle in radians
      angle_radians_lumbar = np.arctan2(resultant_vector_lumbar[1], resultant_vector_lumbar[0])
      # Convert to degrees
      angle_degrees_lumbar = round(np.degrees(angle_radians_lumbar), 0)

      #=======================================

      # Extracting only the vector components and adding them

      resultant_vector = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates], axis=0)
      resultant_vector_normal = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_Normal], axis=0)

      # Calculate the angle in radians
      angle_radians = np.arctan2(resultant_vector[1], resultant_vector[0])

      # Convert to degrees
      angle_degrees = round(np.degrees(angle_radians), 0)

      # Calculating magnitude
      sum_mag = round(np.linalg.norm(resultant_vector), 0)
      sum_mag_normal = round(np.linalg.norm(resultant_vector_normal), 0)

      vec_ratio = np.tan(np.radians(angles))

      # Store all the calculated data into an array that we will then bridge back to JS.
      stored_data = [[round(float(ang),1), round(float(mag_s),1), round(float(mag_O),1), round(float(ratio), 1), level] for ang, mag_s, mag_O, ratio, level in zip(angles, vec_mag_S_non_abs, vec_mag_O_non_abs, vec_ratio, level)]
      stored_data.append([180 - angle_degrees_cervical, sum_mag_cervical, sum_mag_normal_cervical, round(np.tan(angle_radians_cervical),1), 'RSV-C'])
      stored_data.append([180 - angle_degrees_thoracic, sum_mag_thoracic, sum_mag_normal_thoracic, round(np.tan(angle_radians_thoracic), 1), 'RSV-T'])
      stored_data.append([180 - angle_degrees_lumbar, sum_mag_lumbar, sum_mag_normal_lumbar, round(np.tan(angle_radians_lumbar), 1), 'RSV-L'])
      stored_data.append([180 - angle_degrees, sum_mag, sum_mag_normal, round(np.tan(angle_radians), 1), 'GSV'])
    `);

    let storedData = pyodide.globals
      .get("stored_data")
      .toJs({ create_proxies: false });
    console.log(storedData);

    let resultantVector = pyodide.globals
      .get("resultant_vector")
      .toJs({ create_proxies: false });

    let angleDegrees = pyodide.globals.get("angle_degrees");
    let sumMag = pyodide.globals.get("sum_mag");

    return {
      angleDegrees: angleDegrees,
      sumMag: sumMag,
      resultantVector: resultantVector,
    };
  }, [coordinates]);

  // Drawing Methods ----------------------------------------------------------

  // Function called by the canvas when it's ready to draw.
  // This handles drawing the image.
  const draw = (ctx, canvas) => {
    console.log("Drawing!");
    ctx.canvas.width = 600;
    ctx.canvas.height = 600;

    // Only draw the image if we have it. If not, just draw the circles.
    if (selectedImage) {
      const image = new Image();
      image.src = URL.createObjectURL(selectedImage);
      image.onload = () => {
        var ratio = image.naturalWidth / image.naturalHeight;
        if (ratio >= 1.0) {
          var imgWidth = ctx.canvas.width;
          var imgHeight = imgWidth / ratio;
        } else {
          var imgHeight = ctx.canvas.height;
          var imgWidth = imgHeight * ratio;
        }
        ctx.drawImage(image, 0, 0, imgWidth, imgHeight);

        // Make sure to draw the circles on top of the image.
        drawCirclesAndSpine(ctx);
      };
    } else {
      drawCirclesAndSpine(ctx);
    }
  };

  // Function to draw all the added points.
  const drawCirclesAndSpine = (ctx) => {
    coordinates.forEach((coordinate, index) => {
      // Draw a red circle with a black outline.
      ctx.beginPath();
      ctx.arc(coordinate.x, coordinate.y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = "red";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#000000";
      ctx.stroke();

      ctx.font = "16px Arial";
      ctx.fillStyle = "black";
      ctx.fillText(coordinate.label, coordinate.x - 6, coordinate.y - 16);
    });

    // Do not draw both the spline and spine vector.
    if (shouldDrawSpline) {
      drawSpineCommon(ctx, MODE_SPLINE);
    } else if (shouldDrawSpineVec) {
      drawSpineCommon(ctx, MODE_SPINE_VEC);
    }
  };

  const drawSpineCommon = (ctx, mode) => {
    if (coordinates.length < 2) {
      alert("Please add at least 2 spinal level points");
      setShouldDrawSpineVec(false);
      setShouldDrawSpline(false);
      return;
    }

    let tempCoords = [...coordinates];
    tempCoords.sort((a, b) => {
      return a.y < b.y ? -1 : 1;
    });

    globalThis.xVals = tempCoords.map((c) => c.x);
    globalThis.yVals = tempCoords.map((c) => c.y);

    switch (mode) {
      case MODE_SPLINE:
        drawSpline(ctx, tempCoords);
        break;
      case MODE_SPINE_VEC:
        drawSpineVector(ctx, tempCoords);
        break;
      default:
        console.log("Unhandled spine drawing mode");
    }
  };

  // Draws a spline between all points.
  const drawSpline = (ctx, sortedCoords) => {
    console.log("Drawing spline!");

    pyodide.runPython(`
      from js import xVals, yVals

      y = np.asarray(yVals.to_py())
      x = np.asarray(xVals.to_py())
      cs = CubicSpline(y, x, bc_type='natural')

      ynew = np.linspace(np.min(y), np.max(y), 1000)
      xnew = cs(ynew)
      
      angles = calculate_angles(cs, y)
    `);

    // Don't proxy the objects because we want to convert them directly to JS and discard
    // the backing Python object.
    let yNew = pyodide.globals.get("ynew").toJs({ create_proxies: false });
    let xNew = pyodide.globals.get("xnew").toJs({ create_proxies: false });
    let angles = pyodide.globals.get("angles").toJs({ create_proxies: false });

    ctx.beginPath();
    ctx.moveTo(xNew[0], yNew[0]);
    for (let i = 1; i < xNew.length; i++) {
      ctx.lineTo(xNew[i], yNew[i]);
    }
    ctx.stroke();

    for (let i = 0; i < sortedCoords.length; i++) {
      let coordinate = sortedCoords[i];
      ctx.font = "16px Arial";
      ctx.fillStyle = "black";
      // Assume that the number of calculated angles is equal to the number of added points.
      ctx.fillText(
        `${Number.parseFloat(angles[i]).toFixed(2)}°`,
        coordinate.x + 24,
        coordinate.y
      );
    }
  };

  const drawSpineVector = (ctx, sortedCoords) => {
    console.log("Drawing spine vector!");

    if (spineVector == null) {
      alert(
        "Insufficient points to perform spine vector calculations. Please make sure you have " +
          "at least two points for the cervical, thoracic, and lumbar regions."
      );
      setShouldDrawSpineVec(false);
      return;
    }

    // TODO: Dynamically figure out the starting point for the arrow.
    let startX = ctx.canvas.width - 200;
    let startY = 100;
    let endX = spineVector.resultantVector[0] + startX;
    let endY = spineVector.resultantVector[1] + startY;
    // Don't let the arrow render out of bounds.
    endX = Math.max(0, Math.min(endX, ctx.canvas.width - 16));
    endY = Math.max(0, Math.min(endY, ctx.canvas.width - 16));

    drawArrow(ctx, startX, startY, endX, endY, 3, "blue");
  };

  const drawArrow = (ctx, startX, startY, endX, endY, arrowWidth, color) => {
    //variables to be used when creating the arrow
    var headlen = 8;
    var angle = Math.atan2(endY - startY, endX - startX);

    ctx.save();
    ctx.strokeStyle = color;

    //starting path of the arrow from the start square to the end square
    //and drawing the stroke
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.lineWidth = arrowWidth;
    ctx.stroke();

    //starting a new path from the head of the arrow to one of the sides of
    //the point
    ctx.beginPath();
    ctx.lineTo(endX, endY);
    ctx.lineTo(
      endX - headlen * Math.cos(angle - Math.PI / 7),
      endY - headlen * Math.sin(angle - Math.PI / 7)
    );

    //path from the side point of the arrow, to the other side point
    ctx.lineTo(
      endX - headlen * Math.cos(angle + Math.PI / 7),
      endY - headlen * Math.sin(angle + Math.PI / 7)
    );

    //path from the side point back to the tip of the arrow, and then
    //again to the opposite side point
    ctx.lineTo(endX, endY);
    ctx.lineTo(
      endX - headlen * Math.cos(angle - Math.PI / 7),
      endY - headlen * Math.sin(angle - Math.PI / 7)
    );

    //draws the paths created above
    ctx.stroke();
    ctx.restore();
  };

  const resetPoints = () => {
    setCoordinates([]);
    setShouldDrawSpline(false);
    setShouldDrawSpineVec(false);
  };

  // Point Methods ------------------------------------------------------------

  const handleCanvasClick = (event) => {
    // We will offset the stored mouse click coordinates by the
    // top left of the canvas to determine the "absolute" screen
    // coordinate for the click. Otherwise, we would just have the
    // relative coordinate of the click within the canvas and render
    // the point at the wrong position.
    const rect = canvasRef.current.getBoundingClientRect();
    let offset = { x: rect.left, y: rect.top };
    let coord = {
      x: event.clientX - offset.x,
      y: event.clientY - offset.y,
      label: "",
    };
    console.log("Got click at: " + coord.x + ", " + coord.y);

    setNewCoord(coord);
    setDialogOpen(true);
  };

  const handleClose = () => {
    setDialogOpen(false);
  };

  const handlePointSubmit = () => {
    let newLabel = dialogTextRef.current.value;
    if (!newLabel) {
      newLabel = "";
    }
    newCoord.label = newLabel;
    // Commit the new coordinate to memory and clear the buffer.
    setCoordinates([...coordinates, newCoord]);
    setNewCoord(null);
    setDialogOpen(false);
  };

  // UI ------------------------------------------------------------

  function VectorText() {
    if (shouldDrawSpineVec && spineVector) {
      return (
        <>
          <Card variant="outlined">
            <CardContent>
              Vector angle:{" "}
              {(180 - Number.parseFloat(spineVector.angleDegrees)).toFixed(2)}
              °
              <br />
              Vector magnitude:{" "}
              {Number.parseFloat(spineVector.sumMag).toFixed(2)} Newton
            </CardContent>
          </Card>
        </>
      );
    }
  }

  function CanvasButtons() {
    return (
      <>
        <Paper display="flex" elevation={3} sx={{ p: 2 }}>
          <input
            type="file"
            name="selected_image"
            accept="image/*"
            id="button-file"
            hidden
            onChange={(event) => {
              if (event.target.files.length > 0) {
                setSelectedImage(event.target.files[0]);
              }
            }}
          />
          <label htmlFor="button-file">
            <Button
              variant="contained"
              component="span"
              className={ClassNames.Button}
            >
              Select image
            </Button>
            <IconButton
              aria-label="delete"
              sx={{ marginRight: 2 }}
              onClick={() => {
                setSelectedImage(null);
              }}
            >
              <Delete />
            </IconButton>
          </label>
          <Button
            variant="outlined"
            component="span"
            className={ClassNames.Button}
            sx={{ marginX: 2 }}
          >
            Delete point
          </Button>
          <Button
            component="span"
            className={ClassNames.Button}
            sx={{ marginX: 2 }}
            onClick={resetPoints}
          >
            Clear points
          </Button>
        </Paper>
      </>
    );
  }

  function VectorButtons() {
    if (pyodide) {
      return (
        <>
          <Paper display="flex" elevation={3} sx={{ p: 2 }}>
            <Button
              variant="outlined"
              component="span"
              className={ClassNames.Button}
              sx={{ marginX: 2 }}
              onClick={() => {
                setShouldDrawSpineVec(false);
                setShouldDrawSpline(!shouldDrawSpline);
              }}
            >
              {shouldDrawSpline ? "Hide spline" : "Draw spline"}
            </Button>
            <Button
              variant="outlined"
              component="span"
              className={ClassNames.Button}
              sx={{ marginX: 2 }}
              onClick={() => {
                setShouldDrawSpline(false);
                setShouldDrawSpineVec(!shouldDrawSpineVec);
              }}
            >
              {shouldDrawSpineVec ? "Hide spine vector" : "Spine vector"}
            </Button>
            <Button
              variant="outlined"
              component="span"
              className={ClassNames.Button}
              sx={{ marginX: 2 }}
            >
              Show table
            </Button>
          </Paper>
        </>
      );
    } else {
      return null;
    }
  }

  // Canvas hook that waits until the element is initialized before we try drawing.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    draw(context, canvas);
  }, [draw]);

  return (
    <>
      <div>
        <h2>Global Spine Vector Web</h2>
        <h3>
          {!pyodide && "Pyodide is loading"}
          {!pyodide && (
            <CircularProgress disableShrink size={24} sx={{ marginLeft: 4 }} />
          )}
        </h3>
      </div>
      <div id="image-canvas">
        <canvas ref={canvasRef} onClick={handleCanvasClick} />
      </div>
      <div id="editor">
        <Grid container rowSpacing={2} id="data-form">
          <Grid xs={12}>
            <VectorText />
          </Grid>
          <Grid xs={12}>
            <CanvasButtons />
          </Grid>
          <Grid xs={12}>
            <VectorButtons />
          </Grid>
          <Grid xs={12}>
            Enter patient's weight in kg:
            <br />
            <br />
            <TextField
              label="Weight"
              variant="filled"
              defaultValue="60"
              id="pt-weight"
              inputRef={weightTextRef}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">kg</InputAdornment>
                ),
              }}
            />
          </Grid>
        </Grid>
      </div>
      <Dialog open={dialogOpen} onClose={handleClose}>
        <DialogTitle>Add Point</DialogTitle>
        <DialogContent>
          <DialogContentText>Enter the point tag text name:</DialogContentText>
          <TextField
            autoFocus
            required
            margin="dense"
            id="point_tag"
            label="Point tag"
            fullWidth
            variant="standard"
            inputRef={dialogTextRef}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button onClick={handlePointSubmit}>OK</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default App;
