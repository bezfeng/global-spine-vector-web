import { useEffect, useMemo, useRef, useState } from "react";

import { ClassNames } from "@emotion/react";
import { Delete } from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
} from "@mui/material";
import Grid from "@mui/material/Unstable_Grid2";
import Papa from "papaparse";
import { mkConfig, generateCsv, download } from "export-to-csv";

import "./App.css";
import { calcSpineVector, makePyodide, validLevels } from "./SpineHelper";

var MODE_SPLINE = "spline";
var MODE_SPINE_VEC = "spine_vec";

// Default weight is 60 kg.
var DEFAULT_WEIGHT_STRING = "60";

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
  const [spinalLevelSelection, setSpinalLevelSelection] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // State for the weight input text field.
  const [weightText, setWeightText] = useState(DEFAULT_WEIGHT_STRING);

  // State for delete mode.
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [cursorStyle, setCursorStyle] = useState("default");

  const [shouldDrawSpline, setShouldDrawSpline] = useState(false);
  const [shouldDrawSpineVec, setShouldDrawSpineVec] = useState(false);
  const [shouldShowTable, setShouldShowTable] = useState(false);

  const canvasRef = useRef(null);

  // Python Init --------------------------------------------------------------

  let isLoadingPyodide = false;

  useEffect(() => {
    if (pyodide == null && !isLoadingPyodide) {
      isLoadingPyodide = true;
      makePyodide().then((newPyodide) => {
        setPyodide(newPyodide);
        isLoadingPyodide = false;
      });
    }
  }, []);

  const spineVector = useMemo(() => {
    return calcSpineVector(pyodide, coordinates, weightText);
  }, [coordinates, weightText]);

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
        ctx.imageSmoothingQuality = "high";
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

      ctx.font = "12px Arial";
      ctx.fillStyle = "black";
      ctx.fillText(coordinate.label, coordinate.x - 25, coordinate.y);
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
      ctx.font = "14px Arial";
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

    if (isDeleteMode) {
      // Check if the coordinate is near any of our stored points.
      let tempCoords = [...coordinates];
      for (let i = 0; i < tempCoords.length; i++) {
        let storedCoord = tempCoords[i];
        // Accept any click within 32 pixels (16 * 2) of the center of the point.
        // If there are multiple points that fulfill this criteria, the oldest
        // added point will be removed.
        if (
          Math.abs(coord.x - storedCoord.x) <= 16 &&
          Math.abs(coord.y - storedCoord.y) <= 16
        ) {
          console.log("Deleting " + JSON.stringify(storedCoord));
          tempCoords.splice(i, 1);
          break;
        }
      }
      // End delete mode after a click.
      setCoordinates(tempCoords);
      toggleDeleteMode();
    } else {
      setNewCoord(coord);
      setDialogOpen(true);
    }
  };

  const handleClose = () => {
    setDialogOpen(false);
  };

  const handlePointSubmit = () => {
    let newLabel = spinalLevelSelection;
    if (!newLabel) {
      newLabel = "";
    }
    newCoord.label = newLabel;
    // Commit the new coordinate to memory and clear the buffer.
    setCoordinates([...coordinates, newCoord]);
    setNewCoord(null);
    setDialogOpen(false);
  };

  const toggleDeleteMode = () => {
    // Use local state here because setState in React is a deferred action.
    let shouldDelete = !isDeleteMode;
    if (shouldDelete) {
      setCursorStyle("crosshair");
    } else {
      setCursorStyle("default");
    }
    setIsDeleteMode(shouldDelete);
  };

  // Data ----------------------------------------------------------

  const saveData = () => {
    if (!spineVector) {
      return;
    }
    let columnHeaders = [
      "Slope Angle",
      "Shear Vector Magnitude",
      "Normal Vector Magnitude",
      "Vector Ratio",
      "Level",
    ];
    const config = mkConfig({
      showColumnHeaders: true,
      columnHeaders: columnHeaders,
      filename: "spine_vec",
    });
    // Convert the data objects into the appropriate format as required by export-to-csv.
    let dataDict = spineVector.storedData.map((row) => {
      return {
        [columnHeaders[0]]: row[0],
        [columnHeaders[1]]: row[1],
        [columnHeaders[2]]: row[2],
        [columnHeaders[3]]: row[3],
        [columnHeaders[4]]: row[4],
      };
    });
    const csv = generateCsv(config)(dataDict);
    download(config)(csv);

    // Save the coordinates after a 50 ms delay because Safari iOS does not allow
    // back to back downloads.
    setTimeout(() => {
      saveCoords();
    }, 50);
  };

  const saveCoords = () => {
    let columnHeaders = ["Level", "X", "Y"];
    const config = mkConfig({
      showColumnHeaders: true,
      columnHeaders: columnHeaders,
      filename: "coordinates",
    });
    let sortedCoords = [...coordinates];
    sortedCoords.sort((a, b) => {
      return a.y < b.y ? -1 : 1;
    });
    // Convert the data objects into the appropriate format as required by export-to-csv.
    let dataDict = sortedCoords.map((c) => {
      return {
        [columnHeaders[0]]: c.label,
        [columnHeaders[1]]: c.x,
        [columnHeaders[2]]: c.y,
      };
    });
    const csv = generateCsv(config)(dataDict);
    download(config)(csv);
  };

  // UI ------------------------------------------------------------

  function VectorText() {
    if (shouldDrawSpineVec && spineVector) {
      return (
        <>
          <Card variant="outlined">
            <CardContent>
              <b>Resultant Vector</b>
              <br />
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
              sx={{ marginBottom: 1 }}
            >
              Select image
            </Button>
            <IconButton
              aria-label="delete"
              sx={{ marginRight: 2, marginBottom: 1 }}
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
            sx={{ marginX: 2, marginBottom: 1 }}
            color={isDeleteMode ? "error" : "primary"}
            onClick={toggleDeleteMode}
          >
            Delete point
          </Button>
          <input
            type="file"
            name="selected_coords"
            accept=".csv"
            id="button-load"
            hidden
            onChange={(event) => {
              if (event.target.files.length > 0) {
                let config = {
                  header: true,
                  skipEmptyLines: true,
                  complete: (results, file) => {
                    if (results.errors.length != 0) {
                      console.log(results.errors);
                      alert(
                        "Unable to parse saved coordinates! Please make sure " +
                          "you are using a saved CSV from this app."
                      );
                      return;
                    }
                    let savedCoords = results.data.map((c) => {
                      return {
                        x: Number.parseFloat(c.X),
                        y: Number.parseFloat(c.Y),
                        label: c.Level,
                      };
                    });
                    setCoordinates(savedCoords);
                  },
                };
                Papa.parse(event.target.files[0], config);
              }
            }}
          />
          <label htmlFor="button-load">
            <Button
              variant="outlined"
              component="span"
              className={ClassNames.Button}
              sx={{ marginX: 2, marginBottom: 1 }}
              disabled={pyodide == null}
            >
              Load points
            </Button>
          </label>
          <Button
            component="span"
            color="error"
            className={ClassNames.Button}
            sx={{ marginX: 2, marginBottom: 1 }}
            onClick={resetPoints}
          >
            Clear points
          </Button>
        </Paper>
      </>
    );
  }

  function VectorButtons() {
    return (
      <>
        <Paper display="flex" elevation={3} sx={{ p: 2 }}>
          <Button
            variant="outlined"
            component="span"
            className={ClassNames.Button}
            sx={{ marginX: 2, marginBottom: 1 }}
            disabled={pyodide == null}
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
            sx={{ marginX: 2, marginBottom: 1 }}
            disabled={pyodide == null}
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
            sx={{ marginX: 2, marginBottom: 1 }}
            disabled={pyodide == null || spineVector == null}
            onClick={() => {
              setShouldShowTable(!shouldShowTable);
            }}
          >
            {shouldShowTable ? "Hide table" : "Show table"}
          </Button>
          <Button
            variant="outlined"
            component="span"
            className={ClassNames.Button}
            sx={{ marginX: 2, marginBottom: 1 }}
            disabled={pyodide == null || spineVector == null}
            onClick={saveData}
          >
            Save data
          </Button>
        </Paper>
      </>
    );
  }

  function VectorTable() {
    if (spineVector && shouldShowTable) {
      return (
        <>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Vector Angle</TableCell>
                  <TableCell>Shear Vector Magnitude</TableCell>
                  <TableCell>Normal Vector Magnitude</TableCell>
                  <TableCell>Vector Ratio</TableCell>
                  <TableCell>Level</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {spineVector.storedData.map((row) => (
                  <TableRow key={row.level}>
                    <TableCell component="td" scope="row">
                      {row[0]}
                    </TableCell>
                    <TableCell component="td" scope="row">
                      {row[1]}
                    </TableCell>
                    <TableCell component="td" scope="row">
                      {row[2]}
                    </TableCell>
                    <TableCell component="td" scope="row">
                      {row[3]}
                    </TableCell>
                    <TableCell component="td" scope="row">
                      {row[4]}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      );
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
      </div>
      <div id="image-canvas" style={{ cursor: cursorStyle }}>
        <canvas ref={canvasRef} onClick={handleCanvasClick} />
      </div>
      <div id="editor">
        <div>
          {!pyodide && "Pyodide is loading..."}
          {!pyodide && (
            <CircularProgress disableShrink size={24} sx={{ marginLeft: 4 }} />
          )}
        </div>
        <div>
          {!pyodide &&
            "If this is your first time using the web app, ~40 MB of data will be downloaded. This may take a while on slow connections."}
        </div>
        {isDeleteMode && "Select point to delete"}
        <VectorText />
        <VectorTable />
        <Grid container spacing={2} id="data-form">
          <Grid sm={12} md={6}>
            <CanvasButtons />
          </Grid>
          <Grid sm={12} md={6}>
            <VectorButtons />
          </Grid>
          <Grid xs={12}>
            Enter patient's weight in kg:
            <br />
            <br />
            <TextField
              label="Weight"
              variant="filled"
              defaultValue={DEFAULT_WEIGHT_STRING}
              id="pt-weight"
              onChange={(event) => {
                setWeightText(event.target.value);
              }}
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
          <DialogContentText>Select the spinal level:</DialogContentText>
          <FormControl fullWidth sx={{ marginTop: 2 }}>
            <InputLabel id="select-label">Spinal Level</InputLabel>
            <Select
              value={spinalLevelSelection}
              label="Spinal Level"
              onChange={(event) => {
                setSpinalLevelSelection(event.target.value);
              }}
            >
              {[...validLevels].map((level) => (
                <MenuItem key={level} value={level}>
                  {level}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
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
