# Floor Survey (Toolbox host)

Adapted from the proven standalone `floorplan-topo-maker` application.

- **Do not modify** the standalone `floorplan-topo-maker` repository from Toolbox work.
- Source under `floor-survey/src` is a hosted copy: persistence goes through Customer File (`record.floorSurvey.byCanvasId[canvasId]`); plans come from CF media.
- Rebuild the IIFE bundle into Toolbox:

```bash
cd floor-survey
npm install
npm run build
```

Outputs: `js/floor-survey/floor-survey.js` + `floor-survey.css`.
