import { useEffect, useRef, useState } from "react";

import { ClassNames } from "@emotion/react";
import { Delete } from "@mui/icons-material";
import {
  Button,
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
import Spline from "cubic-spline";

import "./App.css";
import { linspace } from "./SpineHelper";
import { Pyodide } from "./pyodide";

function App() {
  // The displayed image.
  const [selectedImage, setSelectedImage] = useState(null);

  // List of points added by the user.
  const [coordinates, setCoordinates] = useState([]);

  // Newly added point that has not been confirmed by user.
  const [newCoord, setNewCoord] = useState(null);

  // List of labels for the points in 'coordinates'.
  // Each label corresponds to the point at the same index.
  const [labels, setLabels] = useState([]);

  // State for the dialog box that prompts users to label their new point.
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogTextRef = useRef(null);

  const [shouldDrawSpline, setShouldDrawSpline] = useState(false);

  const canvasRef = useRef(null);

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
        drawCircles(ctx);
      };
    } else {
      drawCircles(ctx);
    }
  };

  // Function to draw all the added points.
  const drawCircles = (ctx) => {
    coordinates.forEach((coordinate, index) => {
      // Draw a red circle with a black outline.
      ctx.beginPath();
      ctx.arc(coordinate.x, coordinate.y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = "red";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#000000";
      ctx.stroke();

      // Add the label if present.
      if (labels.length > 0) {
        ctx.font = "16px Arial";
        ctx.fillStyle = "black";
        ctx.fillText(labels[index], coordinate.x - 6, coordinate.y - 16);
      }
    });

    if (shouldDrawSpline) {
      drawSpline(ctx);
    }
  };

  // Draws a spline between all points.
  const drawSpline = (ctx) => {
    console.log("Drawing spline!");
    if (coordinates.length < 2) {
      console.log("Not enough points, bailing");
      // TODO: Show an alert here.
      return;
    }

    let tempCoords = [...coordinates];
    tempCoords.sort((a, b) => {
      return a.y < b.y ? -1 : 1;
    });

    let xVals = tempCoords.map((c) => c.x);
    let yVals = tempCoords.map((c) => c.y);

    // TODO: is this Spline class equivalent to the one from scipy?
    // Consider calling into scipy with pyodide.
    const spline = new Spline(yVals, xVals);
    let yNew = linspace(yVals[0], yVals[yVals.length - 1], 1000);
    let xNew = yNew.map((y) => spline.at(y));

    ctx.beginPath();
    ctx.moveTo(xNew[0], yNew[0]);
    for (let i = 1; i < xNew.length; i++) {
      ctx.lineTo(xNew[i], yNew[i]);
    }
    ctx.stroke();
  };

  const handleCanvasClick = (event) => {
    // We will offset the stored mouse click coordinates by the
    // top left of the canvas to determine the "absolute" screen
    // coordinate for the click. Otherwise, we would just have the
    // relative coordinate of the click within the canvas and render
    // the point at the wrong position.
    const rect = canvasRef.current.getBoundingClientRect();
    let offset = { x: rect.left, y: rect.top };
    let coord = { x: event.clientX - offset.x, y: event.clientY - offset.y };
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
    // Commit the new coordinate to memory and clear the buffer.
    setCoordinates([...coordinates, newCoord]);
    setNewCoord(null);
    setLabels([...labels, newLabel]);
    setDialogOpen(false);
  };

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
              onClick={() => {
                setCoordinates([]);
                setLabels([]);
              }}
            >
              Clear points
            </Button>
          </Grid>
          <Grid xs={4}>
            <Button
              variant="outlined"
              component="span"
              className={ClassNames.Button}
              onClick={() => {
                setShouldDrawSpline(!shouldDrawSpline);
              }}
            >
              Draw spline
            </Button>
          </Grid>
          <Grid xs={4}>
            <Button
              variant="outlined"
              component="span"
              className={ClassNames.Button}
            >
              Spine vector
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
          <Grid xs={12}>Enter patient's weight in kg:</Grid>
          <Grid xs={12}>
            <TextField
              label="Weight"
              variant="filled"
              id="pt-weight"
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
