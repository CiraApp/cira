import { IMAGE_EDGE } from "@cira/core";

/**
 * A chosen file, redrawn in the browser as a small square data URL.
 *
 * Whatever was picked becomes a 128 square before it is sent, so what crosses
 * the wire is a few kilobytes of a known shape rather than the photograph
 * somebody dragged in - which is what lets an app's picture and a company's
 * logo live in their own rows instead of needing somewhere to be stored.
 *
 * Cropped to the square from the middle, the same way the tiles crop it on
 * screen, so what is chosen is what appears. Rejects with a sentence a person
 * can read.
 */
export function squarePicture(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.onload = () => {
      const picture = new Image();
      picture.onerror = () => reject(new Error("That file is not an image."));
      picture.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = IMAGE_EDGE;
        canvas.height = IMAGE_EDGE;
        const brush = canvas.getContext("2d");
        if (brush === null) {
          reject(new Error("This browser could not draw that image."));
          return;
        }

        const edge = Math.min(picture.width, picture.height);
        brush.drawImage(
          picture,
          (picture.width - edge) / 2,
          (picture.height - edge) / 2,
          edge,
          edge,
          0,
          0,
          IMAGE_EDGE,
          IMAGE_EDGE,
        );

        resolve(canvas.toDataURL("image/webp", 0.88));
      };
      picture.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
