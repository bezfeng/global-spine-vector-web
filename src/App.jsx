import { useEffect, useRef, useState } from "react";

import { ClassNames } from "@emotion/react";
import { Delete } from "@mui/icons-material";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  TextField,
} from "@mui/material";
import Grid from "@mui/material/Unstable_Grid2";

import "./App.css";
import { calcCumLevel, validLevels } from "./SpineHelper";
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
    makePyodide();
  }, []);

  // Drawing Methods ----------------------------------------------------------

  // Function called by the canvas when it's ready to draw.
  // This handles drawing the image.
  const draw = (ctx, canvas) => {
    console.log("Drawing!");
    ctx.canvas.width = 500;
    ctx.canvas.height = 500;

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
      console.log("Not enough points, bailing");
      // TODO: Show an alert here.
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

    // Default to a weight of 60 kg.
    let weight = 60.0;
    if (weightTextRef.current) {
      weight = Number.parseFloat(weightTextRef.current.value);
    }

    console.log("Performing calculations with weight of " + weight);

    let levelParams = calcCumLevel();

    globalThis.w = weight;
    globalThis.level = sortedCoords.map((c) => c.label);
    globalThis.cumulativeLevelProportion =
      levelParams.cumulativeLevelProportion;
    globalThis.cumulativeSingleLevelProportion =
      levelParams.cumulativeSingleLevelProportion;

    // Make sure the labels are spinal levels. If not, we cannot perform
    // the appropriate calculations so just alert the user and bail.
    for (let i = 0; i < sortedCoords.length; i++) {
      if (!validLevels.has(sortedCoords[i].label)) {
        console.log("Invalid label: " + sortedCoords[i].label);
        return;
      }
    }

    pyodide.runPython(`
      import js

      w = js.w
      cumulative_level_proportion = js.cumulativeLevelProportion.to_py()
      cumulative_single_level_proportion = js.cumulativeSingleLevelProportion.to_py()
      level = js.level.to_py()
    
      y = np.asarray(js.yVals.to_py())
      x = np.asarray(js.xVals.to_py())
      cs = CubicSpline(y, x, bc_type='natural')   

      angles = calculate_angles(cs, y)
      
      vec_mag = [calculate_vector(w, cumulative_single_level_proportion[l], a) for a, l in zip(angles, level)]
      vec_mag_normal = [calculate_vector_normal(w, cumulative_single_level_proportion[l], a) for a, l in
                 zip(angles, level)]

      print(level)
    `);
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

  function VectorButtons() {
    if (pyodide) {
      return (
        <>
          <Grid xs={4}>
            <Button
              variant="outlined"
              component="span"
              className={ClassNames.Button}
              onClick={() => {
                setShouldDrawSpline(!shouldDrawSpline);
              }}
            >
              {shouldDrawSpline ? "Hide spline" : "Draw spline"}
            </Button>
          </Grid>
          <Grid xs={4}>
            <Button
              variant="outlined"
              component="span"
              className={ClassNames.Button}
              onClick={() => {
                setShouldDrawSpline(false);
                setShouldDrawSpineVec(!shouldDrawSpineVec);
              }}
            >
              {shouldDrawSpineVec ? "Hide spine vector" : "Spine vector"}
            </Button>
          </Grid>
          <Grid xs={4}>
            <Button
              variant="outlined"
              component="span"
              className={ClassNames.Button}
            >
              Show table
            </Button>
          </Grid>
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
        <Grid container spacing={2} id="data-form">
          <Grid xs={4}>
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
                onClick={() => {
                  setSelectedImage(null);
                }}
              >
                <Delete />
              </IconButton>
            </label>
          </Grid>
          <Grid xs={4}>
            <Button
              variant="outlined"
              component="span"
              className={ClassNames.Button}
            >
              Delete point
            </Button>
          </Grid>
          <Grid xs={4}>
            <Button
              component="span"
              className={ClassNames.Button}
              onClick={resetPoints}
            >
              Clear points
            </Button>
          </Grid>
          <VectorButtons />
          <Grid xs={12}>Enter patient's weight in kg:</Grid>
          <Grid xs={12}>
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
