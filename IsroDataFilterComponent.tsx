import i18next from "i18next";
import React from "react";
import CesiumMath from "terriajs-cesium/Source/Core/Math";
import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import Ellipsoid from "terriajs-cesium/Source/Core/Ellipsoid";
import EllipsoidGeodesic from "terriajs-cesium/Source/Core/EllipsoidGeodesic";
import Terria from "../../../../Models/Terria";
import UserDrawing from "../../../../Models/UserDrawing";
import ViewerMode from "../../../../Models/ViewerMode";
import { GLYPHS } from "../../../../Styled/Icon";
import MapNavigationItemController from "../../../../ViewModels/MapNavigation/MapNavigationItemController";

// Define the shape of component props
interface IsroDataFilterComponentProps {
  terria: Terria;
  onClose(): void;
}

// Define the component state
interface IsroDataFilterComponentState {
  // Coordinate inputs for AOI (in degrees)
  top: string;    // max latitude
  bottom: string; // min latitude
  left: string;   // min longitude
  right: string;  // max longitude
  // Data product selection (workspaces)
  selectedProducts: { [key: string]: boolean };
  // Optionally, flag to show drawing tool is active
  drawingMode: boolean;
}

export class IsroDataFilterComponent extends MapNavigationItemController<IsroDataFilterComponentProps, IsroDataFilterComponentState> {
  static id = "isro-data-filter";
  static displayName = "ISRO Data Filter";

  private readonly terria: Terria;
  private userDrawing: UserDrawing;

  constructor(props: IsroDataFilterComponentProps) {
    super(props);
    this.terria = props.terria;
    this.state = {
      top: "",
      bottom: "",
      left: "",
      right: "",
      // Initially, assume all three data products are selected.
      selectedProducts: { tmc1: true, tmc2: true, ohrc: true },
      drawingMode: false
    };

    // Set up a UserDrawing instance for drawing AOI (polygon)
    this.userDrawing = new UserDrawing({
      terria: props.terria,
      messageHeader: () =>
        i18next.t("isroDataFilter.header", "ISRO Data Filter"),
      allowPolygon: true,
      onPointClicked: this.onDrawingUpdated.bind(this),
      onPointMoved: this.onDrawingUpdated.bind(this),
      onCleanUp: this.onDrawingCleanUp.bind(this),
      onMakeDialogMessage: () =>
        i18next.t("isroDataFilter.dialogMessage", "Draw an area of interest")
    });
  }

  get glyph(): any {
    // Choose a glyph icon for this tool (or fall back to a default)
    return GLYPHS.filter || GLYPHS.measure;
  }

  get viewerMode(): ViewerMode | undefined {
    return undefined;
  }

  // Handler to update state when coordinate inputs change
  handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    this.setState({ [name]: value } as Pick<IsroDataFilterComponentState, keyof IsroDataFilterComponentState>);
  };

  // Handler for checkbox changes for data product selection
  handleProductChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    this.setState(prevState => ({
      selectedProducts: {
        ...prevState.selectedProducts,
        [name]: checked
      }
    }));
  };

  // Activate the drawing tool
  activateDrawing = () => {
    this.setState({ drawingMode: true });
    this.userDrawing.enterDrawMode();
  };

  // When the drawing is updated (i.e. points are clicked/moved)
  onDrawingUpdated(pointEntities: any) {
    if (this.userDrawing.closeLoop && pointEntities.entities.values.length >= 3) {
      // Compute bounding box from drawn points:
      const lats: number[] = [];
      const lons: number[] = [];
      pointEntities.entities.values.forEach((entity: any) => {
        const pos: Cartesian3 | undefined = entity.position!.getValue(this.terria.timelineClock.currentTime);
        if (pos) {
          const carto = Ellipsoid.WGS84.cartesianToCartographic(pos);
          lats.push(CesiumMath.toDegrees(carto.latitude));
          lons.push(CesiumMath.toDegrees(carto.longitude));
        }
      });
      if (lats.length && lons.length) {
        const top = Math.max(...lats).toFixed(6);
        const bottom = Math.min(...lats).toFixed(6);
        const left = Math.min(...lons).toFixed(6);
        const right = Math.max(...lons).toFixed(6);
        this.setState({ top, bottom, left, right, drawingMode: false });
        // End drawing mode after the polygon is complete.
        this.userDrawing.endDrawing();
      }
    }
  }

  onDrawingCleanUp() {
    this.setState({ drawingMode: false });
  }

  // Build and send a WFS query to GeoServer based on the current input values and selected products.
  queryGeoServer = () => {
    const { top, bottom, left, right, selectedProducts } = this.state;
    // Validate inputs (basic validation)
    if (!top || !bottom || !left || !right) {
      alert("Please provide all coordinate values for the area of interest.");
      return;
    }
    // Create a bounding box polygon in WKT format.
    // WKT POLYGON expects: POLYGON((minLon minLat, maxLon minLat, maxLon maxLat, minLon maxLat, minLon minLat))
    const wktPolygon = `POLYGON((${left} ${bottom}, ${right} ${bottom}, ${right} ${top}, ${left} ${top}, ${left} ${bottom}))`;

    // Determine selected products (assumed to be workspaces here)
    const selectedWorkspaces = Object.keys(selectedProducts).filter(key => selectedProducts[key]);
    if (selectedWorkspaces.length === 0) {
      alert("Please select at least one data product.");
      return;
    }
    // For this example, assume that each workspace has a layer named "datapoints".
    const typeNames = selectedWorkspaces.map(ws => `${ws}:datapoints`).join(",");

    // Construct the WFS GetFeature URL.
    // Replace 'http://your-geoserver-url' with your actual GeoServer URL.
    const geoServerUrl = "http://your-geoserver-url/geoserver/wfs";
    const cqlFilter = `INTERSECTS(geom, ${wktPolygon})`;
    const wfsUrl = `${geoServerUrl}?service=WFS&version=1.1.0&request=GetFeature&typeName=${typeNames}&cql_filter=${encodeURIComponent(cqlFilter)}&outputFormat=application/json`;

    // Query GeoServer.
    fetch(wfsUrl)
      .then(response => response.json())
      .then(geoJsonData => {
        this.addDataToWorkbench(geoJsonData);
      })
      .catch(error => {
        console.error("Error querying GeoServer:", error);
      });
  };

  // Add the returned GeoJSON as a catalog item so that it appears on the workbench.
  addDataToWorkbench(geoJsonData: any) {
    const dataItem = {
      name: "Filtered Data",
      type: "geojson",
      data: geoJsonData,
      isEnabled: true
    };
    this.terria.catalog.userAddedDataGroup.addModel(dataItem);
  }

  // Render the UI
  render() {
    return (
      <div className="isro-data-filter" ref={this.itemRef} style={{ padding: "10px", background: "#f7f7f7" }}>
        <h3>Query Data</h3>
        <div className="data-product-selection" style={{ marginBottom: "10px" }}>
          <strong>Select Data Product(s):</strong>
          <div>
            <label>
              <input
                type="checkbox"
                name="tmc1"
                checked={this.state.selectedProducts.tmc1}
                onChange={this.handleProductChange}
              />{" "}
              tmc1
            </label>
            <label style={{ marginLeft: "10px" }}>
              <input
                type="checkbox"
                name="tmc2"
                checked={this.state.selectedProducts.tmc2}
                onChange={this.handleProductChange}
              />{" "}
              tmc2
            </label>
            <label style={{ marginLeft: "10px" }}>
              <input
                type="checkbox"
                name="ohrc"
                checked={this.state.selectedProducts.ohrc}
                onChange={this.handleProductChange}
              />{" "}
              ohrc
            </label>
          </div>
        </div>
        <div className="aoi-inputs" style={{ marginBottom: "10px" }}>
          <strong>Area of Interest:</strong>
          <div style={{ display: "flex", flexWrap: "wrap", maxWidth: "300px", marginTop: "5px" }}>
            <div style={{ flex: "1 1 45%", margin: "2px" }}>
              <label>Top (max lat):</label>
              <input
                type="number"
                name="top"
                value={this.state.top}
                onChange={this.handleInputChange}
                placeholder="e.g. 48.9"
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ flex: "1 1 45%", margin: "2px" }}>
              <label>Bottom (min lat):</label>
              <input
                type="number"
                name="bottom"
                value={this.state.bottom}
                onChange={this.handleInputChange}
                placeholder="e.g. 48.8"
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ flex: "1 1 45%", margin: "2px" }}>
              <label>Left (min lon):</label>
              <input
                type="number"
                name="left"
                value={this.state.left}
                onChange={this.handleInputChange}
                placeholder="e.g. 2.33"
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ flex: "1 1 45%", margin: "2px" }}>
              <label>Right (max lon):</label>
              <input
                type="number"
                name="right"
                value={this.state.right}
                onChange={this.handleInputChange}
                placeholder="e.g. 2.35"
                style={{ width: "100%" }}
              />
            </div>
          </div>
          <button onClick={this.activateDrawing} style={{ marginTop: "10px" }}>
            Use Draw on Map
          </button>
        </div>
        <div>
          <button onClick={this.queryGeoServer} style={{ padding: "8px 12px" }}>
            Query Data
          </button>
        </div>
      </div>
    );
  }

  // When deactivating, end drawing mode.
  deactivate() {
    this.userDrawing.endDrawing();
    super.deactivate();
  }

  // Activate drawing mode when this tool is activated.
  activate() {
    this.userDrawing.enterDrawMode();
    super.activate();
  }
}

export default IsroDataFilterComponent;
